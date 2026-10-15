package runtimeplugins

import (
	"aster/billing/pkg/pluginapi"
	"aster/billing/pkg/pluginapi/paymentv1"
	"aster/billing/pkg/pluginserver"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newPaymentFixture(t *testing.T) *fixture {
	f := newFixture(t)
	old := filepath.Dir(filepath.Dir(f.binary))
	next := filepath.Join(filepath.Dir(old), "payment.fixture")
	if e := os.Rename(old, next); e != nil {
		t.Fatal(e)
	}
	f.binary = filepath.Join(next, "1.1.0", "plugin")
	f.manifestPath = filepath.Join(next, "1.1.0", "manifest.json")
	f.manifest.ID = "payment.fixture"
	f.manifest.CoreMin = pluginapi.PaymentMinCoreVersion
	f.manifest.Protocol = pluginapi.PaymentProtocol
	f.manifest.Capabilities = pluginapi.PaymentCapabilities()
	f.manifest.Payment = &paymentv1.Declarations{Currencies: []paymentv1.Currency{{Code: "CNY", Precision: 2}, {Code: "JPY", Precision: 0}}, CheckoutHosts: []string{"checkout.example.test"}}
	raw := writeJSON(t, f.manifestPath, f.manifest)
	s := *f.policy.SMTP
	s.ID = f.manifest.ID
	s.MerchantID = "synthetic-merchant"
	s.ManifestSHA256 = digestBytes(raw)
	s.AllowedTargets = []pluginapi.Target{{Host: "gateway.example.test", Port: 443}}
	f.policy.SMTP = nil
	f.policy.Payment = &s
	writeJSON(t, f.manager.policy, f.policy)
	return f
}
func (f *fixture) paymentConfig() paymentv1.Config {
	s := f.policy.Payment
	return paymentv1.Config{MerchantID: s.MerchantID, ProviderID: s.ID, ManifestSHA256: s.ManifestSHA256}
}
func paymentIntent() paymentv1.Intent {
	return paymentv1.Intent{AttemptID: "attempt-1", IdempotencyKey: "attempt-1", InvoiceID: "invoice-1", OrderID: "order-1", AccountID: "account-1", AmountMinor: 1200, Currency: "CNY", CurrencyDecimalPlaces: 2}
}
func paymentCallback() paymentv1.Callback {
	return paymentv1.Callback{Method: "POST", Path: "/callback", Body: []byte(`{}`)}
}
func paymentCheckout() paymentv1.Checkout {
	return paymentv1.Checkout{ProviderID: "payment.fixture", SessionID: "session-1", URL: "https://checkout.example.test/session-1", ExpiresAt: time.Now().Add(time.Hour)}
}
func paymentEvent() paymentv1.VerifiedEvent {
	return paymentv1.VerifiedEvent{AttemptID: "attempt-1", ProviderID: "payment.fixture", EventID: "event-1", TransactionID: "tx-1", MerchantAccountID: "synthetic-merchant", AccountID: "account-1", OrderID: "order-1", InvoiceID: "invoice-1", AmountMinor: 1200, Currency: "CNY", CurrencyDecimalPlaces: 2, SettledAt: time.Now().UTC(), Status: "settled"}
}

type paymentProcessor struct {
	create func(context.Context, paymentv1.Config, paymentv1.Intent) (paymentv1.Checkout, error)
	verify func(context.Context, paymentv1.Config, paymentv1.Callback) (paymentv1.VerifiedEvent, error)
}

func (p paymentProcessor) Create(c context.Context, cfg paymentv1.Config, in paymentv1.Intent) (paymentv1.Checkout, error) {
	if p.create == nil {
		return paymentCheckout(), nil
	}
	return p.create(c, cfg, in)
}
func (p paymentProcessor) Verify(c context.Context, cfg paymentv1.Config, in paymentv1.Callback) (paymentv1.VerifiedEvent, error) {
	if p.verify == nil {
		return paymentEvent(), nil
	}
	return p.verify(c, cfg, in)
}
func (f *fixture) paymentListen(t *testing.T) *net.UnixListener {
	l, e := net.ListenUnix("unix", &net.UnixAddr{Name: f.policy.Payment.Socket, Net: "unix"})
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Chmod(f.policy.Payment.Socket, 0600); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { l.Close() })
	return l
}
func (f *fixture) paymentServe(t *testing.T, p paymentv1.Processor) {
	l := f.paymentListen(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- (pluginserver.PaymentServer{Manifest: f.manifest, ClientUID: f.policy.Payment.ClientUID, MerchantID: f.policy.Payment.MerchantID, Processor: p}).Serve(ctx, l)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case e := <-done:
			if e != nil {
				t.Error(e)
			}
		case <-time.After(3 * time.Second):
			t.Error("payment server failed to stop")
		}
	})
}
func TestPaymentRuntimeContract(t *testing.T) {
	f := newPaymentFixture(t)
	var creates, verifies atomic.Int32
	f.paymentServe(t, paymentProcessor{create: func(_ context.Context, cfg paymentv1.Config, in paymentv1.Intent) (paymentv1.Checkout, error) {
		creates.Add(1)
		if cfg != f.paymentConfig() || in != paymentIntent() {
			t.Error("request changed")
		}
		return paymentCheckout(), nil
	}, verify: func(_ context.Context, _ paymentv1.Config, in paymentv1.Callback) (paymentv1.VerifiedEvent, error) {
		verifies.Add(1)
		if string(in.Body) != "{}" {
			t.Error("raw callback changed")
		}
		return paymentEvent(), nil
	}})
	if s := f.manager.PaymentState(); s.Status != "approved" || s.Protocol != pluginapi.PaymentProtocol {
		t.Fatal(s)
	}
	if id, e := f.manager.PaymentCheck(context.Background()); e != nil || id.ID != "payment.fixture" {
		t.Fatal(id, e)
	}
	if creates.Load() != 0 || verifies.Load() != 0 {
		t.Fatal("check performed payment")
	}
	if out, e := f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent()); e != nil || out.SessionID != "session-1" {
		t.Fatal(out, e)
	}
	if out, e := f.manager.VerifyPaymentCallback(context.Background(), f.paymentConfig(), paymentCallback()); e != nil || out.TransactionID != "tx-1" {
		t.Fatal(out, e)
	}
	if creates.Load() != 1 || verifies.Load() != 1 {
		t.Fatal("duplicated operation")
	}
	if got, e := f.manager.Discover(); e != nil || len(got) != 1 || got[0].Protocol != pluginapi.PaymentProtocol {
		t.Fatal(got, e)
	}
	f.policy.Payment.Enabled = false
	writeJSON(t, f.manager.policy, f.policy)
	os.Remove(f.binary)
	if s := f.manager.PaymentState(); s.Status != "disabled" || s.ID != "payment.fixture" {
		t.Fatal(s)
	}
	if _, e := f.manager.PaymentCheck(context.Background()); !errors.Is(e, ErrDisabled) {
		t.Fatal(e)
	}
}
func TestPaymentPinsAndCurrencyBeforeDispatch(t *testing.T) {
	for _, mode := range []string{"merchant", "provider", "manifest", "currency", "precision", "attempt"} {
		t.Run(mode, func(t *testing.T) {
			f := newPaymentFixture(t)
			var calls atomic.Int32
			f.paymentServe(t, paymentProcessor{create: func(context.Context, paymentv1.Config, paymentv1.Intent) (paymentv1.Checkout, error) {
				calls.Add(1)
				return paymentCheckout(), nil
			}})
			cfg, in := f.paymentConfig(), paymentIntent()
			switch mode {
			case "merchant":
				cfg.MerchantID = "other"
			case "provider":
				cfg.ProviderID = "payment.other"
			case "manifest":
				cfg.ManifestSHA256 = strings.Repeat("0", 64)
			case "currency":
				in.Currency = "USD"
			case "precision":
				in.CurrencyDecimalPlaces = 0
			case "attempt":
				in.IdempotencyKey = "other"
			}
			if _, e := f.manager.CreatePayment(context.Background(), cfg, in); e == nil || calls.Load() != 0 {
				t.Fatal("unsafe dispatch", e, calls.Load())
			}
		})
	}
}

func TestPaymentPreservesConfiguredHTTPSCallbackOrigin(t *testing.T) {
	for _, origin := range []string{"https://billing.example.test:8443", "https://127.0.0.1:8443", "https://[::1]:8443"} {
		t.Run(origin, func(t *testing.T) {
			f := newPaymentFixture(t)
			var got atomic.Value
			f.paymentServe(t, paymentProcessor{create: func(_ context.Context, _ paymentv1.Config, in paymentv1.Intent) (paymentv1.Checkout, error) {
				got.Store(in.CallbackURL)
				return paymentCheckout(), nil
			}})
			in := paymentIntent()
			in.CallbackURL = origin + "/api/v1/payment-callbacks/payment.fixture"
			if _, e := f.manager.CreatePayment(context.Background(), f.paymentConfig(), in); e != nil || got.Load() != in.CallbackURL {
				t.Fatal("configured callback origin changed or rejected", e, got.Load())
			}
		})
	}
}
func TestPaymentApprovalRejectsMetadata(t *testing.T) {
	for _, mode := range []string{"currency", "precision", "host", "capability", "protocol", "merchant", "cross-slot"} {
		t.Run(mode, func(t *testing.T) {
			f := newPaymentFixture(t)
			switch mode {
			case "currency":
				f.manifest.Payment.Currencies = append(f.manifest.Payment.Currencies, f.manifest.Payment.Currencies[0])
			case "precision":
				f.manifest.Payment.Currencies[0].Precision = 7
			case "host":
				f.manifest.Payment.CheckoutHosts = []string{"*.example.test"}
			case "capability":
				f.manifest.Capabilities = append(f.manifest.Capabilities, "database.write")
			case "protocol":
				f.manifest.Protocol = "aster.payment/2"
			case "merchant":
				f.policy.Payment.MerchantID = "bad merchant"
			case "cross-slot":
				s := *f.policy.Payment
				s.ID = "email.smtp"
				s.MerchantID = ""
				f.policy.SMTP = &s
			}
			raw := writeJSON(t, f.manifestPath, f.manifest)
			f.policy.Payment.ManifestSHA256 = digestBytes(raw)
			writeJSON(t, f.manager.policy, f.policy)
			if s := f.manager.PaymentState(); s.Status != "unavailable" {
				t.Fatal("unsafe metadata accepted", s)
			}
		})
	}
}
func TestPaymentCrashTimeoutAndCircuit(t *testing.T) {
	for _, mode := range []string{"panic", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			f := newPaymentFixture(t)
			var calls atomic.Int32
			f.paymentServe(t, paymentProcessor{create: func(ctx context.Context, _ paymentv1.Config, _ paymentv1.Intent) (paymentv1.Checkout, error) {
				calls.Add(1)
				if mode == "panic" {
					panic("secret-canary")
				}
				<-ctx.Done()
				return paymentv1.Checkout{}, errors.New("secret-canary")
			}})
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			start := time.Now()
			_, e := f.manager.CreatePayment(ctx, f.paymentConfig(), paymentIntent())
			if e == nil || strings.Contains(e.Error(), "secret-canary") || calls.Load() != 1 || time.Since(start) > time.Second {
				t.Fatal(e, calls.Load(), time.Since(start))
			}
			if f.manager.PaymentState().Status != "approved" {
				t.Fatal("core damaged by plugin failure")
			}
		})
	}
	f := newPaymentFixture(t)
	for i := 0; i < 3; i++ {
		f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent())
	}
	if f.manager.paymentBlockedUntil.IsZero() {
		t.Fatal("circuit did not open")
	}
	f.paymentServe(t, paymentProcessor{})
	if _, e := f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent()); e == nil {
		t.Fatal("cooldown ignored")
	}
	f.manager.paymentMu.Lock()
	f.manager.paymentBlockedUntil = time.Now().Add(-time.Second)
	f.manager.paymentMu.Unlock()
	if _, e := f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent()); e != nil {
		t.Fatal(e)
	}
}
func TestPaymentClientRejectsForgedEvidence(t *testing.T) {
	for _, mode := range []string{"merchant", "provider", "precision", "transaction", "future", "status", "nonce", "host", "missing outcome"} {
		t.Run(mode, func(t *testing.T) {
			f := newPaymentFixture(t)
			l := f.paymentListen(t)
			var calls atomic.Int32
			srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/v1/handshake" {
					var h pluginapi.Hello
					json.NewDecoder(r.Body).Decode(&h)
					json.NewEncoder(w).Encode(pluginapi.Identity{Protocol: f.manifest.Protocol, ID: f.manifest.ID, Version: f.manifest.Version, SHA256: f.manifest.SHA256, Capabilities: f.manifest.Capabilities, Nonce: h.Nonce})
					return
				}
				calls.Add(1)
				if mode == "host" {
					var in pluginapi.PaymentCreateRequest
					json.NewDecoder(r.Body).Decode(&in)
					out := paymentCheckout()
					out.URL = "https://unapproved.example.test"
					json.NewEncoder(w).Encode(pluginapi.PaymentCreateResponse{Protocol: pluginapi.PaymentProtocol, RequestID: in.RequestID, Status: "accepted", Checkout: &out})
					return
				}
				var in pluginapi.PaymentVerifyRequest
				json.NewDecoder(r.Body).Decode(&in)
				event := paymentEvent()
				out := pluginapi.PaymentVerifyResponse{Protocol: pluginapi.PaymentProtocol, RequestID: in.RequestID, Status: "verified", Event: &event}
				switch mode {
				case "merchant":
					event.MerchantAccountID = "other"
				case "provider":
					event.ProviderID = "payment.other"
				case "precision":
					event.CurrencyDecimalPlaces = 0
				case "transaction":
					event.TransactionID = ""
				case "future":
					event.SettledAt = time.Now().Add(time.Hour)
				case "status":
					event.Status = "paid"
				case "nonce":
					out.RequestID = strings.Repeat("0", 64)
				case "missing outcome":
					out.Status = ""
				}
				json.NewEncoder(w).Encode(out)
			})}
			go srv.Serve(l)
			t.Cleanup(func() { srv.Close() })
			var e error
			if mode == "host" {
				_, e = f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent())
			} else {
				_, e = f.manager.VerifyPaymentCallback(context.Background(), f.paymentConfig(), paymentCallback())
			}
			if e == nil || calls.Load() != 1 {
				t.Fatal("forged evidence accepted", e, calls.Load())
			}
		})
	}
}
func TestPaymentBoundedConcurrency(t *testing.T) {
	f := newPaymentFixture(t)
	started := make(chan struct{}, 8)
	release := make(chan struct{})
	defer close(release)
	f.paymentServe(t, paymentProcessor{create: func(ctx context.Context, _ paymentv1.Config, _ paymentv1.Intent) (paymentv1.Checkout, error) {
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return paymentCheckout(), nil
	}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for i := 0; i < 8; i++ {
		go f.manager.CreatePayment(ctx, f.paymentConfig(), paymentIntent())
	}
	for i := 0; i < 8; i++ {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("calls did not start")
		}
	}
	start := time.Now()
	if _, e := f.manager.CreatePayment(context.Background(), f.paymentConfig(), paymentIntent()); e == nil || time.Since(start) > time.Second {
		t.Fatal("busy worker did not reject promptly", e)
	}
}

func TestPaymentServerRequiresOneOperationOnHandshakenConnection(t *testing.T) {
	f := newPaymentFixture(t)
	var calls atomic.Int32
	f.paymentServe(t, paymentProcessor{create: func(context.Context, paymentv1.Config, paymentv1.Intent) (paymentv1.Checkout, error) {
		calls.Add(1)
		return paymentCheckout(), nil
	}})
	client := func() *http.Client {
		return &http.Client{Transport: &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", f.policy.Payment.Socket)
		}}}
	}
	first, second := client(), client()
	defer first.CloseIdleConnections()
	defer second.CloseIdleConnections()
	nonce := strings.Repeat("a", 64)
	request := pluginapi.PaymentCreateRequest{Protocol: pluginapi.PaymentProtocol, Version: f.manifest.Version, RequestID: nonce, TimeoutMS: 1000, Config: f.paymentConfig(), Intent: paymentIntent()}
	var out pluginapi.PaymentCreateResponse
	if exchange(context.Background(), first, "/v1/payment/checkout", request, &out) == nil || calls.Load() != 0 {
		t.Fatal("unhandshaken operation accepted")
	}
	var identity pluginapi.Identity
	if e := exchange(context.Background(), first, "/v1/handshake", pluginapi.Hello{Protocol: pluginapi.PaymentProtocol, CoreVersion: pluginapi.CoreVersion, Nonce: nonce}, &identity); e != nil {
		t.Fatal(e)
	}
	if exchange(context.Background(), second, "/v1/payment/checkout", request, &out) == nil || calls.Load() != 0 {
		t.Fatal("handshake moved between connections")
	}
	if e := exchange(context.Background(), first, "/v1/payment/checkout", request, &out); e != nil || out.Status != "accepted" {
		t.Fatal(e, out)
	}
	if exchange(context.Background(), first, "/v1/payment/checkout", request, &out) == nil || calls.Load() != 1 {
		t.Fatal("connection replay accepted")
	}
}
