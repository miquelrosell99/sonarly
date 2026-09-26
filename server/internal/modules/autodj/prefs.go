package autodj

import "encoding/json"

// decodePreferences parses the user_preferences JSON blob. Callers treat a
// parse error as "no preferences" (v1's try/catch → defaults).
func decodePreferences(raw string) (map[string]any, error) {
	var prefs map[string]any
	if err := json.Unmarshal([]byte(raw), &prefs); err != nil {
		return nil, err
	}
	return prefs, nil
}

// numberValue coerces a JSON number stored as float64 (the only numeric
// shape encoding/json produces) into a float64.
func numberValue(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok
}
