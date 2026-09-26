package playlists

import "testing"

// TestParseRulesStrictness: malformed shapes are 400s before they ever
// reach the compiler or the database.
func TestParseRulesStrictness(t *testing.T) {
	valid := []string{
		`{}`,
		`{"rules":{}}`,
		`{"rules":{"all":[{"field":"title","operator":"is","value":"x"}]}}`,
		`{"rules":{"any":[{"field":"year","operator":"gt","value":2000}]},"limit":10}`,
		`{"sort":[{"random":true},{"field":"title","direction":"desc"}]}`,
		`{"limitPercent":25}`,
	}
	for _, raw := range valid {
		if _, err := ParseRules([]byte(raw)); err != nil {
			t.Errorf("valid rules rejected: %s: %v", raw, err)
		}
	}

	invalid := []string{
		`not json`,
		`[]`,
		`"x"`,
		`42`,
		`{"rules":{"all":"nope"}}`,
		`{"rules":{"all":[{"operator":"is"}]}}`,
		`{"rules":{"all":[{"field":"title"}]}}`,
		`{"sort":"nope"}`,
		`{"sort":[{"direction":"desc"}]}`,
		`{"sort":[{"random":true,"field":"title"}]}`,
		`{"sort":[{"field":"title","direction":"sideways"}]}`,
		`{"limit":"ten"}`,
		`{"rules":{"all":[{"field":"title","operator":"is","value":{"obj":1}}]}}`,
	}
	for _, raw := range invalid {
		if _, err := ParseRules([]byte(raw)); err == nil {
			t.Errorf("invalid rules accepted: %s", raw)
		} else if !IsRulesError(err) {
			t.Errorf("invalid rules must surface RulesError: %s: %v", raw, err)
		}
	}

	// Negative/zero limits parse fine and mean "no limit" (old resolveLimit
	// semantics) — the compiler clamps oversized positive limits instead.
	if rules, err := ParseRules([]byte(`{"limitPercent":-5}`)); err != nil || rules.LimitPercent == nil {
		t.Errorf("negative limitPercent: rules=%v err=%v", rules, err)
	}

	// Empty input means "no rules" (static playlist).
	if rules, err := ParseRules(nil); err != nil || rules != nil {
		t.Errorf("nil input: rules=%v err=%v", rules, err)
	}
}
