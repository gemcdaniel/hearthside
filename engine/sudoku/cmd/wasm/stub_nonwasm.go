//go:build !(js && wasm)

// Command wasm is built with GOOS=js GOARCH=wasm; this stub keeps native go vet/test/lint clean.
package main

func main() {}
