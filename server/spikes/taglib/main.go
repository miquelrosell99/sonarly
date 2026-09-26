// S1 spike, option B: github.com/sentriz/go-taglib (go.senan.xyz/taglib).
// TagLib 2.1.1 compiled to Wasm, embedded — no CGO. Survey comparison against
// dhowden/tag on the same corpus. Throwaway spike code, own Go module.
//
// Usage: go run . <corpus-dir> > taglib_dump.json
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"go.senan.xyz/taglib"
)

func main() {
	dir := os.Args[1]
	entries, _ := os.ReadDir(dir)
	out := map[string]interface{}{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := filepath.Join(dir, e.Name())
		res := map[string]interface{}{}

		tags, err := taglib.ReadTags(p)
		if err != nil {
			res["tagsError"] = err.Error()
		} else {
			keys := make([]string, 0, len(tags))
			for k := range tags {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			m := map[string]interface{}{}
			for _, k := range keys {
				m[k] = tags[k]
			}
			res["tags"] = m
		}

		props, err := taglib.ReadProperties(p)
		if err != nil {
			res["propsError"] = err.Error()
		} else {
			res["properties"] = map[string]interface{}{
				"lengthSec":  props.Length.Seconds(),
				"bitRate":    props.BitRate,
				"bitDepth":   props.BitDepth,
				"sampleRate": props.SampleRate,
				"channels":   props.Channels,
				"format":     props.Format,
				"innerCodec": props.InnerCodec,
				"images":     props.Images,
			}
		}

		img, err := taglib.ReadImage(p)
		if err != nil {
			res["imageError"] = err.Error()
		} else {
			res["imageBytes"] = len(img)
		}

		out[e.Name()] = res
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}
