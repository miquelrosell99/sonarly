package main

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Throwaway: dump every registered route for the endpoint reconciliation.
func TestRouteDump(t *testing.T) {
	router := newContractRouter(t)
	_ = chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		fmt.Printf("ROUTE %s %s\n", method, normalizeChiRoute(route))
		return nil
	})
}
