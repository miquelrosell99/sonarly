package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"golang.org/x/crypto/bcrypt"
)

// Domain rules carried over from v1.
const (
	MinPasswordLength = 8
	bcryptCost        = 12
	minBitrateKbps    = 64
	maxBitrateKbps    = 320
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrSetupCompleted     = errors.New("setup already completed")
	ErrUsernameRequired   = errors.New("username is required")
	ErrPasswordRequired   = errors.New("password is required")
	ErrPasswordTooShort   = fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	ErrInvalidTranscode   = errors.New("invalid transcode format")
	ErrInvalidBitrate     = errors.New("invalid max bitrate")
	ErrNotFound           = errors.New("user not found")
	ErrUsernameTaken      = errors.New("username already exists")
	ErrLastAdminDemote    = errors.New("cannot demote the last admin")
	ErrLastAdminDelete    = errors.New("cannot delete the last admin")
	ErrSelfDelete         = errors.New("cannot delete your own account")
)

// PublicUser is the API-facing user shape; password material never reaches it.
type PublicUser struct {
	ID                 string  `json:"id"`
	Username           string  `json:"username"`
	IsAdmin            bool    `json:"isAdmin"`
	CreatedAt          string  `json:"createdAt"`
	Name               *string `json:"name,omitempty"`
	Surname            *string `json:"surname,omitempty"`
	Email              *string `json:"email,omitempty"`
	AvatarURL          string  `json:"avatarUrl,omitempty"`
	MaxBitrateKbps     *int    `json:"maxBitrateKbps,omitempty"`
	TranscodeFormat    *string `json:"transcodeFormat,omitempty"`
	HideExplicit       bool    `json:"hideExplicit"`
	BlurExplicitTitles bool    `json:"blurExplicitTitles"`
	BlurExplicitCovers bool    `json:"blurExplicitCovers"`
}

func toPublic(u *dbUser) PublicUser {
	pub := PublicUser{
		ID:                 u.ID,
		Username:           u.Username,
		IsAdmin:            u.IsAdmin,
		CreatedAt:          u.CreatedAt,
		Name:               u.Name,
		Surname:            u.Surname,
		Email:              u.Email,
		MaxBitrateKbps:     u.MaxBitrateKbps,
		TranscodeFormat:    u.TranscodeFormat,
		HideExplicit:       u.HideExplicit,
		BlurExplicitTitles: u.BlurExplicitTitles,
		BlurExplicitCovers: u.BlurExplicitCovers,
	}
	if u.AvatarPath != nil && *u.AvatarPath != "" {
		pub.AvatarURL = "/api/avatars/" + u.ID
	}
	return pub
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func validTranscodeFormat(f string) bool {
	switch f {
	case "mp3", "aac", "opus":
		return true
	}
	return false
}

func hashCredentials(password, secret string) (passwordHash, subsonicEncrypted string, err error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", "", fmt.Errorf("hash password: %w", err)
	}
	enc, err := auth.EncryptSecret(password, secret)
	if err != nil {
		return "", "", err
	}
	return string(hash), enc, nil
}

// Service is the users domain API. Routes translate its sentinel errors to
// HTTP statuses; everything else is an internal failure (500 + log).
type Service struct {
	db       *sql.DB
	sessions *auth.Store
	secret   string
	dataDir  string
	throttle *auth.LoginThrottle
}

func NewService(db *sql.DB, sessions *auth.Store, sessionSecret, dataDir string) *Service {
	return &Service{db: db, sessions: sessions, secret: sessionSecret, dataDir: dataDir, throttle: auth.NewLoginThrottle()}
}

// LoginLocked reports whether the ip:username pair is login-throttled.
func (s *Service) LoginLocked(remoteAddr, username string) bool {
	return s.throttle.Locked(remoteAddr, username)
}

// RecordLoginFailure registers one failed login attempt.
func (s *Service) RecordLoginFailure(remoteAddr, username string) {
	s.throttle.RecordFailure(remoteAddr, username)
}

// RecordLoginSuccess clears the throttle state for the pair.
func (s *Service) RecordLoginSuccess(remoteAddr, username string) {
	s.throttle.RecordSuccess(remoteAddr, username)
}

// Login verifies credentials and returns the user. Unknown username and
// wrong password are indistinguishable (ErrInvalidCredentials) so the
// endpoint cannot enumerate accounts.
func (s *Service) Login(ctx context.Context, username, password string) (*PublicUser, error) {
	u, err := GetByUsernameWithSecrets(ctx, s.db, username)
	if IsNoRows(err) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	pub := toPublic(u)
	return &pub, nil
}

// SetupNeeded reports whether the zero-users setup gate is open.
func (s *Service) SetupNeeded(ctx context.Context) (bool, error) {
	n, err := Count(ctx, s.db)
	if err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}
	return n == 0, nil
}

// SetupInput is the first-run admin creation payload.
type SetupInput struct {
	Username string
	Password string
	Name     string
	Surname  string
	Email    string
}

// Setup creates the first admin. The zero-users check and the insert run in
// one transaction (bcrypt outside it — v1 checked the count, yielded, then
// inserted, so two concurrent setups could both pass; this closes that
// TOCTOU). The new user is an admin, like v1.
func (s *Service) Setup(ctx context.Context, in SetupInput) (*PublicUser, error) {
	username := strings.TrimSpace(in.Username)
	if username == "" {
		return nil, ErrUsernameRequired
	}
	if in.Password == "" {
		return nil, ErrPasswordRequired
	}
	if len(in.Password) < MinPasswordLength {
		return nil, ErrPasswordTooShort
	}
	passwordHash, subsonicEnc, err := hashCredentials(in.Password, s.secret)
	if err != nil {
		return nil, err
	}

	id := uuid.NewString()
	now := nowISO()
	name, surname, email := optTrimmed(in.Name), optTrimmed(in.Surname), optTrimmed(in.Email)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin setup: %w", err)
	}
	defer tx.Rollback()

	n, err := Count(ctx, tx)
	if err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}
	if n > 0 {
		return nil, ErrSetupCompleted
	}
	err = Insert(ctx, tx, InsertParams{
		ID: id, Username: username,
		PasswordHash: passwordHash, SubsonicPasswordEncrypted: subsonicEnc,
		IsAdmin: true, CreatedAt: now,
		Name: name, Surname: surname, Email: email,
	})
	if err != nil {
		if IsUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit setup: %w", err)
	}

	return &PublicUser{
		ID: id, Username: username, IsAdmin: true, CreatedAt: now,
		Name: name, Surname: surname, Email: email,
	}, nil
}

// GetPublicByID loads a user for /api/me.
func (s *Service) GetPublicByID(ctx context.Context, id string) (*PublicUser, error) {
	u, err := GetByID(ctx, s.db, id)
	if IsNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}
	pub := toPublic(u)
	return &pub, nil
}

// ListPublic lists all users for the admin panel.
func (s *Service) ListPublic(ctx context.Context) ([]PublicUser, error) {
	rows, err := List(ctx, s.db)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	users := make([]PublicUser, 0, len(rows))
	for i := range rows {
		users = append(users, toPublic(&rows[i]))
	}
	return users, nil
}

// CreateInput is the admin user-creation payload.
type CreateInput struct {
	Username        string
	Password        string
	IsAdmin         bool
	Name            string
	Surname         string
	Email           string
	MaxBitrateKbps  *int
	TranscodeFormat *string
}

// CreateUser creates a user from the admin panel.
func (s *Service) CreateUser(ctx context.Context, in CreateInput) error {
	username := strings.TrimSpace(in.Username)
	if username == "" {
		return ErrUsernameRequired
	}
	if in.Password == "" {
		return ErrPasswordRequired
	}
	if len(in.Password) < MinPasswordLength {
		return ErrPasswordTooShort
	}
	if in.TranscodeFormat != nil && !validTranscodeFormat(*in.TranscodeFormat) {
		return ErrInvalidTranscode
	}
	if in.MaxBitrateKbps != nil && (*in.MaxBitrateKbps < minBitrateKbps || *in.MaxBitrateKbps > maxBitrateKbps) {
		return ErrInvalidBitrate
	}
	passwordHash, subsonicEnc, err := hashCredentials(in.Password, s.secret)
	if err != nil {
		return err
	}
	err = Insert(ctx, s.db, InsertParams{
		ID: uuid.NewString(), Username: username,
		PasswordHash: passwordHash, SubsonicPasswordEncrypted: subsonicEnc,
		IsAdmin: in.IsAdmin, CreatedAt: nowISO(),
		Name: optTrimmed(in.Name), Surname: optTrimmed(in.Surname), Email: optTrimmed(in.Email),
		MaxBitrateKbps: in.MaxBitrateKbps, TranscodeFormat: in.TranscodeFormat,
	})
	if err != nil {
		if IsUniqueViolation(err) {
			return ErrUsernameTaken
		}
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

// AdminUpdateInput is the admin user-edit payload. Pointer fields are absent
// (untouched) vs present; Optional* fields additionally distinguish explicit
// null (clear the column), mirroring v1's undefined|null semantics.
type AdminUpdateInput struct {
	IsAdmin         *bool          `json:"isAdmin"`
	Name            OptionalString `json:"name"`
	Surname         OptionalString `json:"surname"`
	Email           OptionalString `json:"email"`
	Password        *string        `json:"password"`
	MaxBitrateKbps  OptionalInt    `json:"maxBitrateKbps"`
	TranscodeFormat OptionalString `json:"transcodeFormat"`
	HideExplicit    OptionalBool   `json:"hideExplicit"`
	BlurExplicit    OptionalBool   `json:"blurExplicitTitles"`
	BlurCovers      OptionalBool   `json:"blurExplicitCovers"`
}

// UpdateUser applies an admin edit to the target user. A role or password
// change invalidates every session of that user (audit B9, v1 parity).
func (s *Service) UpdateUser(ctx context.Context, targetID string, in AdminUpdateInput) error {
	existing, err := GetByID(ctx, s.db, targetID)
	if IsNoRows(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load user: %w", err)
	}

	if in.IsAdmin != nil && !*in.IsAdmin && existing.IsAdmin {
		n, err := CountAdmins(ctx, s.db)
		if err != nil {
			return fmt.Errorf("count admins: %w", err)
		}
		if n <= 1 {
			return ErrLastAdminDemote
		}
	}
	if in.TranscodeFormat.Set && !in.TranscodeFormat.Null && !validTranscodeFormat(in.TranscodeFormat.Value) {
		return ErrInvalidTranscode
	}
	if in.MaxBitrateKbps.Set && !in.MaxBitrateKbps.Null &&
		(in.MaxBitrateKbps.Value < minBitrateKbps || in.MaxBitrateKbps.Value > maxBitrateKbps) {
		return ErrInvalidBitrate
	}

	var passwordHash, subsonicEnc *string
	if in.Password != nil {
		if len(*in.Password) < MinPasswordLength {
			return ErrPasswordTooShort
		}
		h, e, err := hashCredentials(*in.Password, s.secret)
		if err != nil {
			return err
		}
		passwordHash, subsonicEnc = &h, &e
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update: %w", err)
	}
	defer tx.Rollback()

	if in.IsAdmin != nil {
		if err := SetIsAdmin(ctx, tx, targetID, *in.IsAdmin); err != nil {
			return fmt.Errorf("update admin flag: %w", err)
		}
	}
	if err := UpdateTranscoding(ctx, tx, targetID, in.MaxBitrateKbps, in.TranscodeFormat); err != nil {
		return fmt.Errorf("update transcoding: %w", err)
	}
	if err := UpdateContentFilters(ctx, tx, targetID, in.HideExplicit, in.BlurExplicit, in.BlurCovers); err != nil {
		return fmt.Errorf("update content filters: %w", err)
	}
	if err := UpdateProfile(ctx, tx, targetID, in.Name, in.Surname, in.Email, passwordHash, subsonicEnc); err != nil {
		return fmt.Errorf("update profile: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit update: %w", err)
	}

	if in.IsAdmin != nil || passwordHash != nil {
		if err := s.sessions.DeleteAllForUser(ctx, targetID); err != nil {
			return fmt.Errorf("invalidate sessions: %w", err)
		}
	}
	return nil
}

// DeleteUser removes the target user. The actor cannot delete their own
// account, and the last admin cannot be deleted; session invalidation and
// the user delete are one transaction so a deleted user has no live session
// even if the process dies between statements.
func (s *Service) DeleteUser(ctx context.Context, actorID, targetID string) error {
	existing, err := GetByID(ctx, s.db, targetID)
	if IsNoRows(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load user: %w", err)
	}
	if actorID == targetID {
		return ErrSelfDelete
	}
	if existing.IsAdmin {
		n, err := CountAdmins(ctx, s.db)
		if err != nil {
			return fmt.Errorf("count admins: %w", err)
		}
		if n <= 1 {
			return ErrLastAdminDelete
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete: %w", err)
	}
	defer tx.Rollback()
	if err := s.sessions.DeleteAllForUserTx(ctx, tx, targetID); err != nil {
		return fmt.Errorf("invalidate sessions: %w", err)
	}
	if err := Delete(ctx, tx, targetID); err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return tx.Commit()
}

// optTrimmed maps a whitespace/empty optional string to NULL.
func optTrimmed(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}
