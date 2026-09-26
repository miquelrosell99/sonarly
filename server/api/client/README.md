# GENERATED — do not edit by hand

`index.ts` is produced from the OpenAPI contract by
[openapi-typescript](https://github.com/openapi-ts/openapi-typescript):

```sh
npx openapi-typescript ../openapi.yaml -o index.ts
```

Regenerate after every `openapi.yaml` change (the Go coverage test in
`cmd/sonarly/spec_test.go` keeps the spec honest; this file is its codegen
consumer). `proof.ts` is a compile-only consumer that exercises the typed
fetch surface — it is checked with `tsc --noEmit` (see `tsconfig.json`).
