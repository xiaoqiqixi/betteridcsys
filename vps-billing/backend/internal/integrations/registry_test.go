package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type testPayment struct {
	checkout Checkout
	err      error
	verified *VerifiedPayment
}

func (p testPayment) CreateCheckout(context.Context, CheckoutRequest) (Checkout, error) {
	return p.checkout, p.err
}
func (p testPayment) VerifyCallback(context.Context, CallbackRequest) (VerifiedPayment, error) {
	if p.verified != nil {
		return *p.verified, p.err
	}
	return VerifiedPayment{}, ErrUnavailable
}

func TestCallbackNormalizedMoneyBounds(t *testing.T) {
	valid := VerifiedPayment{ProviderID: "payment.test", EventID: "event", TransactionID: "transaction", MerchantAccountID: "merchant", AccountID: "a", OrderID: "o", InvoiceID: "i", AmountMinor: 100, Currency: "CNY", Status: "settled", SettledAt: time.Now()}
	for _, tc := range []struct {
		currency string
		amount   int64
		valid    bool
	}{{"CNY", 100, true}, {"USD", 100, true}, {"EUR", 100, false}, {"cny", 100, false}, {"USD", maxMinor + 1, false}, {"USD", 0, false}} {
		value := valid
		value.Currency, value.AmountMinor = tc.currency, tc.amount
		d := definition()
		d.Manifest.ConfigurationFields = nil
		d.PaymentFactory = func(context.Context, Config) (PaymentProvider, error) { return testPayment{verified: &value}, nil }
		r, err := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID})
		if err != nil {
			t.Fatal(err)
		}
		_, err = r.VerifyCallback(context.Background(), CallbackRequest{})
		if tc.valid != (err == nil) {
			t.Fatal(tc, err)
		}
	}
}
func definition() Definition {
	return Definition{Manifest: Manifest{ID: "payment.test", Kind: Payment, Name: "Test only", Description: "Never registered by server", Capabilities: []string{"checkout"}, SupportedCurrencies: []string{"CNY", "USD"}, ConfigurationFields: []ConfigurationField{{Key: "api_key", Label: "API key reference", Type: "secret_ref", Required: true, Secret: true}}}, CheckoutHosts: []string{"checkout.example.com"}, PaymentFactory: func(context.Context, Config) (PaymentProvider, error) {
		return testPayment{checkout: Checkout{ProviderID: "payment.test", SessionID: "s1", URL: "https://checkout.example.com/session/1", ExpiresAt: time.Now().Add(time.Hour)}}, nil
	}}
}
func TestRegistryValidationAndRedaction(t *testing.T) {
	d := definition()
	ctx := context.Background()
	cases := []struct {
		name string
		defs []Definition
		opts Options
	}{
		{"duplicate", []Definition{d, d}, Options{}},
		{"reserved", []Definition{{Manifest: Manifest{ID: "payment.disabled", Kind: Payment, Name: "override", Description: "bad"}, CheckoutHosts: d.CheckoutHosts, PaymentFactory: d.PaymentFactory}}, Options{}},
		{"unknown selection", nil, Options{PaymentID: "missing"}},
		{"wrong kind", []Definition{d}, Options{EmailID: d.Manifest.ID}},
		{"required missing", []Definition{d}, Options{PaymentID: d.Manifest.ID}},
		{"raw secret", []Definition{d}, Options{Configs: map[string]Config{d.Manifest.ID: {"api_key": "secret-value"}}}},
		{"unknown field", []Definition{d}, Options{Configs: map[string]Config{d.Manifest.ID: {"surprise": "value"}}}},
		{"unknown config", nil, Options{Configs: map[string]Config{"missing": {}}}},
		{"bad timeout", nil, Options{Timeout: time.Minute}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := New(ctx, tc.defs, tc.opts); e == nil {
				t.Fatal("accepted invalid registry")
			}
		})
	}
	t.Setenv("TEST_PROVIDER_SECRET", "not-for-api")
	r, e := New(ctx, []Definition{d}, Options{PaymentID: d.Manifest.ID, Configs: map[string]Config{d.Manifest.ID: {"api_key": "env:TEST_PROVIDER_SECRET"}}})
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(r.Summaries())
	for _, s := range []string{"not-for-api", "TEST_PROVIDER_SECRET", "env:"} {
		if strings.Contains(string(b), s) {
			t.Fatal("secret/ref leaked")
		}
	}
	a := r.Summaries()
	a[0].Name = "mutated"
	a[2].Capabilities[0] = "mutated"
	if r.Summaries()[0].Name == "mutated" || r.Summaries()[2].Capabilities[0] == "mutated" {
		t.Fatal("registry mutable through summaries")
	}
	if a[0].ID != "email.disabled" || a[1].ID != "payment.disabled" || a[2].ID != "payment.test" {
		t.Fatal("non-deterministic order")
	}
}
func TestDisabledNeverSucceeds(t *testing.T) {
	r := Default()
	ctx := context.Background()
	if _, e := r.CreateCheckout(ctx, CheckoutRequest{InvoiceID: "i", OrderID: "o", AccountID: "a", AmountMinor: 100, Currency: "USD", IdempotencyKey: "key"}); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
	if _, e := r.SendEmail(ctx, EmailMessage{}); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
	if _, e := r.VerifyCallback(ctx, CallbackRequest{}); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
}

func TestCurrencyCapabilitiesAndSafeMoney(t *testing.T) {
	d := definition()
	d.Manifest.ConfigurationFields = nil
	for _, currencies := range [][]string{nil, {"EUR"}, {"usd"}, {"USD", "USD"}} {
		bad := d
		bad.Manifest.SupportedCurrencies = currencies
		if _, err := New(context.Background(), []Definition{bad}, Options{}); err == nil {
			t.Fatal("invalid provider currencies", currencies)
		}
	}
	d.Manifest.SupportedCurrencies = []string{"USD"}
	r, err := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID})
	if err != nil {
		t.Fatal(err)
	}
	d.Manifest.SupportedCurrencies[0] = "CNY"
	summaries := r.Summaries()
	summaries[2].SupportedCurrencies[0] = "CNY"
	request := CheckoutRequest{InvoiceID: "i", OrderID: "o", AccountID: "a", AmountMinor: 100, Currency: "USD", IdempotencyKey: "test-key"}
	if _, err = r.CreateCheckout(context.Background(), request); err != nil {
		t.Fatal("mutable capabilities", err)
	}
	request.Currency = "CNY"
	if _, err = r.CreateCheckout(context.Background(), request); !errors.Is(err, ErrUnsupportedCurrency) {
		t.Fatal(err)
	}
	request.Currency = "EUR"
	if _, err = r.CreateCheckout(context.Background(), request); !errors.Is(err, ErrInvalidResult) {
		t.Fatal(err)
	}
	request.Currency = "USD"
	request.AmountMinor = maxMinor + 1
	if _, err = r.CreateCheckout(context.Background(), request); !errors.Is(err, ErrInvalidResult) {
		t.Fatal(err)
	}
	for _, summary := range Default().Summaries() {
		if len(summary.SupportedCurrencies) != 0 {
			t.Fatal("disabled capabilities", summary)
		}
	}
}
func TestCheckoutURLValidation(t *testing.T) {
	for _, u := range []string{"http://checkout.example.com/s", "https://evil.example/s", "https://checkout.example.com.evil.example/s", "https://user:password@checkout.example.com/s", "https://checkout.example.com:8443/s", "javascript:alert(1)", "https://checkout.example.com/s#fragment"} {
		t.Run(u, func(t *testing.T) {
			d := definition()
			d.Manifest.ConfigurationFields = nil
			d.PaymentFactory = func(context.Context, Config) (PaymentProvider, error) {
				return testPayment{checkout: Checkout{ProviderID: d.Manifest.ID, SessionID: "s", URL: u, ExpiresAt: time.Now().Add(time.Hour)}}, nil
			}
			r, e := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID})
			if e != nil {
				t.Fatal(e)
			}
			_, e = r.CreateCheckout(context.Background(), CheckoutRequest{InvoiceID: "i", OrderID: "o", AccountID: "a", AmountMinor: 100, Currency: "USD", IdempotencyKey: "key"})
			if !errors.Is(e, ErrInvalidResult) {
				t.Fatal(e)
			}
		})
	}
}
func TestSecretResolution(t *testing.T) {
	t.Setenv("TEST_SECRET", "value")
	if v, e := ResolveSecret("env:TEST_SECRET"); v != "value" || e != nil {
		t.Fatal(v, e)
	}
	for _, r := range []string{"literal", "env:MISSING_SECRET", "file:relative"} {
		if _, e := ResolveSecret(r); e == nil {
			t.Fatal("unexpected secret", r)
		}
	}
}

func TestSettlementValidationDoesNotTrustClaims(t *testing.T) {
	want := SettlementExpectation{ProviderID: "payment.test", MerchantAccountID: "merchant", AccountID: "account", OrderID: "order", InvoiceID: "invoice", AmountMinor: 600, Currency: "USD"}
	valid := VerifiedPayment{ProviderID: want.ProviderID, MerchantAccountID: want.MerchantAccountID, AccountID: want.AccountID, OrderID: want.OrderID, InvoiceID: want.InvoiceID, AmountMinor: want.AmountMinor, Currency: want.Currency, EventID: "event", TransactionID: "transaction", Status: "settled", SettledAt: time.Now()}
	if e := ValidateSettlement(valid, want); e != nil {
		t.Fatal(e)
	}
	for _, currency := range []string{"CNY", "USD", "EUR"} {
		expected, actual := want, valid
		expected.Currency, actual.Currency = currency, currency
		err := ValidateSettlement(actual, expected)
		if (currency == "EUR") != (err != nil) {
			t.Fatal("settlement currency", currency, err)
		}
	}
	unsafeExpected, unsafeActual := want, valid
	unsafeExpected.AmountMinor, unsafeActual.AmountMinor = maxMinor+1, maxMinor+1
	if ValidateSettlement(unsafeActual, unsafeExpected) == nil {
		t.Fatal("unsafe settlement amount")
	}
	for _, change := range []func(*VerifiedPayment){func(v *VerifiedPayment) { v.AmountMinor = 1 }, func(v *VerifiedPayment) { v.Currency = "EUR" }, func(v *VerifiedPayment) { v.AccountID = "other" }, func(v *VerifiedPayment) { v.OrderID = "other" }, func(v *VerifiedPayment) { v.InvoiceID = "other" }, func(v *VerifiedPayment) { v.MerchantAccountID = "other" }, func(v *VerifiedPayment) { v.ProviderID = "other" }, func(v *VerifiedPayment) { v.EventID = "" }, func(v *VerifiedPayment) { v.TransactionID = "" }, func(v *VerifiedPayment) { v.Status = "pending" }} {
		v := valid
		change(&v)
		if e := ValidateSettlement(v, want); e == nil {
			t.Fatal("accepted mismatched callback")
		}
	}
}
func TestMissingSecretFailsStartup(t *testing.T) {
	d := definition()
	_, e := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID, Configs: map[string]Config{d.Manifest.ID: {"api_key": "env:TEST_NONEXISTENT_PROVIDER_SECRET"}}})
	if e == nil {
		t.Fatal("started without secret")
	}
}

func TestStrictConfigFile(t *testing.T) {
	valid := `{"payment.test":{"api_key":"env:TEST_SECRET","merchant":"example"}}`
	c, e := DecodeConfigs(strings.NewReader(valid))
	if e != nil || c["payment.test"]["api_key"] != "env:TEST_SECRET" {
		t.Fatal(c, e)
	}
	for _, raw := range []string{"null", "[]", `{"payment.test":null}`, `{"payment.test":{"key":null}}`, `{"payment.test":{"key":true}}`, `{"payment.test":{"key":{}}}`, `{"payment.test":{},"payment.test":{}}`, `{"payment.test":{"key":"a","key":"b"}}`, `{} {}`, `{"payment.test":`, strings.Repeat(" ", 65537)} {
		if _, e := DecodeConfigs(strings.NewReader(raw)); e == nil {
			t.Fatal("accepted invalid config")
		}
	}
}

type testEmail struct {
	receipt EmailReceipt
	calls   int
}

func (e *testEmail) Send(context.Context, EmailMessage) (EmailReceipt, error) {
	e.calls++
	return e.receipt, nil
}
func TestEmailContract(t *testing.T) {
	adapter := &testEmail{receipt: EmailReceipt{ProviderMessageID: "recorded-test-only"}}
	r, e := New(context.Background(), []Definition{{Manifest: Manifest{ID: "email.test", Kind: Email, Name: "Test", Description: "Test only"}, EmailFactory: func(context.Context, Config) (EmailProvider, error) { return adapter, nil }}}, Options{EmailID: "email.test"})
	if e != nil {
		t.Fatal(e)
	}
	for _, m := range []EmailMessage{{}, {To: "invalid", Template: "welcome", IdempotencyKey: "key"}, {To: "test@example.com", Template: "welcome"}, {To: "test@example.com", IdempotencyKey: "key"}} {
		if _, e := r.SendEmail(context.Background(), m); !errors.Is(e, ErrInvalidResult) {
			t.Fatal(e)
		}
	}
	if adapter.calls != 0 {
		t.Fatal("invalid email reached adapter")
	}
	m := EmailMessage{To: "test@example.com", Template: "welcome", IdempotencyKey: "email-id"}
	if v, e := r.SendEmail(context.Background(), m); e != nil || v.ProviderMessageID == "" {
		t.Fatal(v, e)
	}
	adapter.receipt = EmailReceipt{}
	if _, e := r.SendEmail(context.Background(), m); !errors.Is(e, ErrInvalidResult) {
		t.Fatal("empty success receipt", e)
	}
}

func TestTypedNilFactoryFailsStartup(t *testing.T) {
	d := definition()
	d.Manifest.ConfigurationFields = nil
	d.PaymentFactory = func(context.Context, Config) (PaymentProvider, error) { var p *testPayment; return p, nil }
	if _, e := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID}); e == nil {
		t.Fatal("accepted typed nil adapter")
	}
}

type deadlinePayment struct{}

func (deadlinePayment) CreateCheckout(ctx context.Context, _ CheckoutRequest) (Checkout, error) {
	<-ctx.Done()
	return Checkout{}, ctx.Err()
}
func (deadlinePayment) VerifyCallback(ctx context.Context, _ CallbackRequest) (VerifiedPayment, error) {
	<-ctx.Done()
	return VerifiedPayment{}, ctx.Err()
}
func TestProviderDeadline(t *testing.T) {
	d := definition()
	d.Manifest.ConfigurationFields = nil
	d.PaymentFactory = func(context.Context, Config) (PaymentProvider, error) { return deadlinePayment{}, nil }
	r, e := New(context.Background(), []Definition{d}, Options{PaymentID: d.Manifest.ID, Timeout: time.Millisecond})
	if e != nil {
		t.Fatal(e)
	}
	_, e = r.CreateCheckout(context.Background(), CheckoutRequest{InvoiceID: "i", OrderID: "o", AccountID: "a", AmountMinor: 100, Currency: "USD", IdempotencyKey: "key"})
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
}
