package playlists

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// Rules is the JSON shape stored in playlists.rules_json — single-level
// groups, matching packages/shared/src/smart-playlist.ts (wire parity, no
// nested groups):
//
//	{rules?: {all?: Rule[], any?: Rule[]}, sort?: Sort[], limit?: number, limitPercent?: number}
//
// A rule matches when every `all` rule matches AND at least one `any` rule
// matches; a missing group side is simply not constrained.
type Rules struct {
	Group        *RuleGroup `json:"rules,omitempty"`
	Sort         []Sort     `json:"sort,omitempty"`
	Limit        *int       `json:"limit,omitempty"`
	LimitPercent *int       `json:"limitPercent,omitempty"`
}

// RuleGroup is one single-level group of rules (wire parity: no nesting).
type RuleGroup struct {
	All []Rule `json:"all,omitempty"`
	Any []Rule `json:"any,omitempty"`
}

// Rule is one field/operator/value triple. Value may be a string, number,
// boolean, or a two-element number array (inTheRange).
type Rule struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value,omitempty"`
}

// Sort is one ordering clause: either {field, direction} or {random: true}.
type Sort struct {
	Field     string `json:"field,omitempty"`
	Direction string `json:"direction,omitempty"`
	Random    bool   `json:"random,omitempty"`
}

// RulesError is a smart-rules validation failure (HTTP 400), as opposed to
// an internal compilation error.
type RulesError struct{ msg string }

func (e *RulesError) Error() string { return e.msg }

func rulesErrorf(format string, args ...any) *RulesError {
	return &RulesError{msg: fmt.Sprintf(format, args...)}
}

// IsRulesError reports whether err is a rules validation failure.
func IsRulesError(err error) bool {
	var re *RulesError
	return errors.As(err, &re)
}

// rawRules mirrors the JSON wire shape during strict decoding.
type rawRules struct {
	Rules *struct {
		All []rawRule `json:"all"`
		Any []rawRule `json:"any"`
	} `json:"rules"`
	Sort         []rawSort `json:"sort"`
	Limit        *int      `json:"limit"`
	LimitPercent *int      `json:"limitPercent"`
}

type rawRule struct {
	Field    string          `json:"field"`
	Operator string          `json:"operator"`
	Value    json.RawMessage `json:"value"`
}

type rawSort struct {
	Field     *string `json:"field"`
	Direction *string `json:"direction"`
	Random    *bool   `json:"random"`
}

// ParseRules strictly decodes and structurally validates rules JSON (the
// wire/database shape). Field/operator whitelists are semantic checks done
// by the compiler (Compile), which needs the database for inPlaylist
// ownership anyway; here we only validate shapes and value types so a
// malformed body never reaches the compiler or the database.
func ParseRules(data []byte) (*Rules, error) {
	if len(data) == 0 {
		return nil, nil
	}
	var raw rawRules
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, rulesErrorf("rules must be a valid JSON object")
	}
	// Reject trailing garbage after the top-level object.
	if dec.More() {
		return nil, rulesErrorf("rules must be a single JSON object")
	}

	rules := &Rules{Limit: raw.Limit, LimitPercent: raw.LimitPercent}
	if raw.Rules != nil {
		group := &RuleGroup{}
		var err error
		if group.All, err = decodeRules(raw.Rules.All, "rules.all"); err != nil {
			return nil, err
		}
		if group.Any, err = decodeRules(raw.Rules.Any, "rules.any"); err != nil {
			return nil, err
		}
		rules.Group = group
	}
	if raw.Sort != nil {
		sorts := make([]Sort, 0, len(raw.Sort))
		for i, rs := range raw.Sort {
			switch {
			case rs.Random != nil && *rs.Random:
				if rs.Field != nil || rs.Direction != nil {
					return nil, rulesErrorf("sort[%d]: random cannot be combined with field/direction", i)
				}
				sorts = append(sorts, Sort{Random: true})
			case rs.Field != nil && *rs.Field != "":
				s := Sort{Field: *rs.Field}
				if rs.Direction != nil {
					if *rs.Direction != "asc" && *rs.Direction != "desc" {
						return nil, rulesErrorf("sort[%d]: direction must be asc or desc", i)
					}
					s.Direction = *rs.Direction
				}
				if rs.Random != nil {
					return nil, rulesErrorf("sort[%d]: random cannot be combined with field/direction", i)
				}
				sorts = append(sorts, s)
			default:
				return nil, rulesErrorf("sort[%d]: either field or random is required", i)
			}
		}
		rules.Sort = sorts
	}
	return rules, nil
}

func decodeRules(raw []rawRule, where string) ([]Rule, error) {
	out := make([]Rule, 0, len(raw))
	for i, rr := range raw {
		if rr.Field == "" {
			return nil, rulesErrorf("%s[%d]: field is required", where, i)
		}
		if rr.Operator == "" {
			return nil, rulesErrorf("%s[%d]: operator is required", where, i)
		}
		rule := Rule{Field: rr.Field, Operator: rr.Operator}
		if len(rr.Value) > 0 && string(rr.Value) != "null" {
			v, err := decodeRuleValue(rr.Value)
			if err != nil {
				return nil, rulesErrorf("%s[%d]: %v", where, i, err)
			}
			rule.Value = v
		}
		out = append(out, rule)
	}
	return out, nil
}

// decodeRuleValue normalizes a rule value to string, bool, float64, or
// []any of homogeneous JSON scalars (inTheRange pairs).
func decodeRuleValue(data json.RawMessage) (any, error) {
	var v any
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("value must be a JSON scalar or array")
	}
	switch t := v.(type) {
	case string, bool, json.Number:
		if n, ok := t.(json.Number); ok {
			f, err := n.Float64()
			if err != nil {
				return nil, fmt.Errorf("value must be a number, string, boolean, or array")
			}
			return f, nil
		}
		return t, nil
	case []any:
		for _, item := range t {
			switch item.(type) {
			case string, bool, json.Number:
			default:
				return nil, fmt.Errorf("array values must contain only scalars")
			}
		}
		return t, nil
	default:
		return nil, fmt.Errorf("value must be a number, string, boolean, or array")
	}
}
