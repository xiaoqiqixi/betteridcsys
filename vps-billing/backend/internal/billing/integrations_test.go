package billing

import (
	"aster/billing/internal/integrations"
	"context"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type checkoutRecorder struct {
	mu       sync.Mutex
	requests []integrations.CheckoutRequest
}

func (p *checkoutRecorder) CreateCheckout(_ context.Context, r integrations.CheckoutRequest) (integrations.Checkout, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, r)
	return integrations.Checkout{ProviderID: "payment.test", SessionID: "test-session", URL: "https://checkout.example.com/session", ExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (p *checkoutRecorder) VerifyCallback(context.Context, integrations.CallbackRequest) (integrations.VerifiedPayment, error) {
	return integrations.VerifiedPayment{}, integrations.ErrUnavailable
}
func TestInjectedCheckoutBoundary(t *testing.T) {
	recorder := &checkoutRecorder{}
	registry, e := integrations.New(context.Background(), []integrations.Definition{{Manifest: integrations.Manifest{ID: "payment.test", Kind: integrations.Payment, Name: "Test", Description: "Test only", Capabilities: []string{"checkout"}}, CheckoutHosts: []string{"checkout.example.com"}, PaymentFactory: func(context.Context, integrations.Config) (integrations.PaymentProvider, error) { return recorder, nil }}}, integrations.Options{PaymentID: "payment.test"})
	if e != nil {
		t.Fatal(e)
	}
	m := NewMemory()
	srv := httptest.NewServer(NewAppWithIntegrations(m, Config{Demo: true, Origin: "http://localhost", Secret: ID() + ID()}, registry).Handler())
	defer srv.Close()
	c := client(t, srv.URL, "demo@aster.local", "DemoCustomer!2026")
	other := client(t, srv.URL, "other@aster.local", "DemoOther!2026")
	admin := client(t, srv.URL, "admin@aster.local", "DemoAdmin!2026")
	anonymous := client(t, srv.URL, "", "")
	for _, tc := range []struct {
		c    *testClient
		want int
	}{{c, 403}, {other, 403}, {anonymous, 401}, {admin, 200}} {
		s, v := tc.c.request("GET", "/api/v1/admin/integrations", nil, "")
		if s != tc.want {
			t.Fatal(s, v)
		}
	}
	if s, _ := admin.request("POST", "/api/v1/admin/integrations", map[string]any{"enabled": true}, ""); s != 404 {
		t.Fatal("unexpected configuration write", s)
	}
	if s, v := c.request("POST", "/api/v1/orders", map[string]string{"plan_id": "starter", "hostname": "plugin-test"}, "plugin-test-1"); s != 201 {
		t.Fatal(s, v)
	}
	_, v := c.request("GET", "/api/v1/invoices", nil, "")
	inv := v["data"].([]any)[0].(map[string]any)
	id := inv["id"].(string)
	path := "/api/v1/invoices/" + id + "/checkout"
	if s, _ := other.request("POST", path, nil, ""); s != 404 {
		t.Fatal(s)
	}
	token := c.csrf
	c.csrf = "bad"
	if s, _ := c.request("POST", path, nil, ""); s != 403 {
		t.Fatal(s)
	}
	c.csrf = token
	recorder.mu.Lock()
	n := len(recorder.requests)
	recorder.mu.Unlock()
	if n != 0 {
		t.Fatal("adapter called before authorization")
	}
	for range 2 {
		s, v := c.request("POST", path, map[string]any{"amount_minor": 1, "url": "https://evil.example"}, "")
		if s != 200 {
			t.Fatal(s, v)
		}
	}
	recorder.mu.Lock()
	requests := append([]integrations.CheckoutRequest{}, recorder.requests...)
	recorder.mu.Unlock()
	if len(requests) != 2 || requests[0].AmountMinor != 600 || requests[0].Currency != "USD" || requests[0].InvoiceID != id || requests[0].OrderID != inv["order_id"] || requests[0].AccountID == "" || requests[0].IdempotencyKey != requests[1].IdempotencyKey {
		t.Fatal(requests)
	}
	_, v = c.request("GET", "/api/v1/invoices/"+id, nil, "")
	if v["data"].(map[string]any)["status"] != "unpaid" {
		t.Fatal("checkout marked paid")
	}
	_, v = c.request("GET", "/api/v1/orders", nil, "")
	if v["data"].([]any)[0].(map[string]any)["status"] != "pending_payment" {
		t.Fatal("checkout changed order state")
	}
	m.mu.Lock()
	for j := range m.invoices {
		if m.invoices[j].ID == id {
			m.invoices[j].Status = "paid"
		}
	}
	m.mu.Unlock()
	if s, _ := c.request("POST", path, nil, ""); s != 409 {
		t.Fatal("paid invoice payable", s)
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if len(recorder.requests) != 2 {
		t.Fatal("paid invoice reached provider")
	}
}
