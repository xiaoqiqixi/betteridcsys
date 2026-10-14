package integrations

import (
	"context"
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_.-]{1,63}$`)
var currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)
var envName = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)

type Registry struct {
	summaries     []Summary
	payment       PaymentProvider
	email         EmailProvider
	paymentID     string
	emailID       string
	checkoutHosts []string
	timeout       time.Duration
}
type disabled struct{}

func (disabled) CreateCheckout(context.Context, CheckoutRequest) (Checkout, error) {
	return Checkout{}, ErrUnavailable
}
func (disabled) VerifyCallback(context.Context, CallbackRequest) (VerifiedPayment, error) {
	return VerifiedPayment{}, ErrUnavailable
}
func (disabled) Send(context.Context, EmailMessage) (EmailReceipt, error) {
	return EmailReceipt{}, ErrUnavailable
}

func Default() *Registry { r, _ := New(context.Background(), nil, Options{}); return r }

// New validates every installed manifest and configuration before constructing
// selected adapters in sorted ID order. Registry is immutable after construction.
func New(ctx context.Context, definitions []Definition, o Options) (*Registry, error) {
	if o.PaymentID == "" {
		o.PaymentID = "payment.disabled"
	}
	if o.EmailID == "" {
		o.EmailID = "email.disabled"
	}
	if o.Timeout == 0 {
		o.Timeout = 8 * time.Second
	}
	if o.Timeout < time.Millisecond || o.Timeout > 10*time.Second {
		return nil, fmt.Errorf("invalid integration timeout")
	}
	r := &Registry{payment: disabled{}, email: disabled{}, paymentID: o.PaymentID, emailID: o.EmailID, timeout: o.Timeout}
	defs := map[string]Definition{}
	for _, kind := range []Kind{Payment, Email} {
		id := string(kind) + ".disabled"
		defs[id] = Definition{Manifest: Manifest{ID: id, Kind: kind, Name: map[Kind]string{Payment: "支付未接入", Email: "邮件未接入"}[kind], Description: "安全关闭的默认适配器，不执行外部操作", Capabilities: []string{}, ConfigurationFields: []ConfigurationField{}, Limitations: []string{"未安装真实服务商；不会扣款、发送邮件或变更账务状态"}}}
	}
	for _, d := range definitions {
		if err := validateDefinition(d); err != nil {
			return nil, err
		}
		if _, ok := defs[d.Manifest.ID]; ok {
			return nil, fmt.Errorf("duplicate integration ID: %s", d.Manifest.ID)
		}
		d.Manifest = cloneManifest(d.Manifest)
		d.CheckoutHosts = append([]string{}, d.CheckoutHosts...)
		defs[d.Manifest.ID] = d
	}
	if d, ok := defs[o.PaymentID]; !ok || d.Manifest.Kind != Payment {
		return nil, fmt.Errorf("unknown payment provider")
	}
	if d, ok := defs[o.EmailID]; !ok || d.Manifest.Kind != Email {
		return nil, fmt.Errorf("unknown email provider")
	}
	for id := range o.Configs {
		if _, ok := defs[id]; !ok {
			return nil, fmt.Errorf("configuration for unknown provider")
		}
	}
	ids := make([]string, 0, len(defs))
	for id := range defs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		d := defs[id]
		selected := id == o.PaymentID || id == o.EmailID
		builtin := id == "payment.disabled" || id == "email.disabled"
		cfg := Config{}
		for k, v := range o.Configs[id] {
			cfg[k] = v
		}
		configured, err := validateConfig(d.Manifest, cfg)
		if err != nil {
			return nil, err
		}
		s := Summary{Manifest: cloneManifest(d.Manifest), Enabled: selected && !builtin, Configured: configured && !builtin, Status: "disabled", ConfigurationMode: "environment"}
		if s.Enabled {
			if !configured {
				return nil, fmt.Errorf("missing required configuration for %s", id)
			}
			for _, field := range d.Manifest.ConfigurationFields {
				if field.Secret && cfg[field.Key] != "" {
					if _, e := ResolveSecret(cfg[field.Key]); e != nil {
						return nil, fmt.Errorf("required secret unavailable for %s", id)
					}
				}
			}
			c, cancel := context.WithTimeout(ctx, o.Timeout)
			if d.Manifest.Kind == Payment {
				r.payment, err = d.PaymentFactory(c, cfg)
				r.checkoutHosts = append([]string{}, d.CheckoutHosts...)
			} else {
				r.email, err = d.EmailFactory(c, cfg)
			}
			timedOut := c.Err()
			cancel()
			if err != nil || timedOut != nil || nilAdapter(r.payment) || nilAdapter(r.email) {
				return nil, fmt.Errorf("initialization failed for %s", id)
			}
			s.Status = "ready"
		}
		r.summaries = append(r.summaries, s)
	}
	return r, nil
}
func validateDefinition(d Definition) error {
	m := d.Manifest
	if !identifier.MatchString(m.ID) || m.Name == "" || m.Description == "" {
		return fmt.Errorf("invalid integration manifest")
	}
	if (m.Kind == Payment && (d.PaymentFactory == nil || d.EmailFactory != nil)) || (m.Kind == Email && (d.EmailFactory == nil || d.PaymentFactory != nil)) || (m.Kind != Payment && m.Kind != Email) {
		return fmt.Errorf("invalid factory for %s", m.ID)
	}
	keys := map[string]bool{}
	for _, f := range m.ConfigurationFields {
		if !identifier.MatchString(f.Key) || keys[f.Key] || f.Label == "" || (f.Type != "string" && f.Type != "secret_ref" && f.Type != "url") || f.Secret != (f.Type == "secret_ref") {
			return fmt.Errorf("invalid configuration schema for %s", m.ID)
		}
		keys[f.Key] = true
	}
	if m.Kind == Payment && len(d.CheckoutHosts) == 0 {
		return fmt.Errorf("checkout host allowlist required for %s", m.ID)
	}
	for _, h := range d.CheckoutHosts {
		if h == "" || strings.ToLower(h) != h || strings.ContainsAny(h, "/:@*?# ") || net.ParseIP(h) != nil || !strings.Contains(h, ".") {
			return fmt.Errorf("invalid checkout host for %s", m.ID)
		}
	}
	return nil
}
func validateConfig(m Manifest, c Config) (bool, error) {
	fields := map[string]ConfigurationField{}
	complete := true
	for _, f := range m.ConfigurationFields {
		fields[f.Key] = f
		if f.Required && strings.TrimSpace(c[f.Key]) == "" {
			complete = false
		}
	}
	for k, v := range c {
		f, ok := fields[k]
		if !ok {
			return false, fmt.Errorf("unknown configuration field for %s", m.ID)
		}
		if v == "" {
			continue
		}
		if f.Secret && !validSecretRef(v) {
			return false, fmt.Errorf("invalid secret reference for %s", m.ID)
		}
		if f.Type == "url" {
			u, e := url.Parse(v)
			if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
				return false, fmt.Errorf("invalid HTTPS configuration for %s", m.ID)
			}
		}
	}
	return complete, nil
}
func validSecretRef(ref string) bool {
	if strings.HasPrefix(ref, "env:") {
		return envName.MatchString(strings.TrimPrefix(ref, "env:"))
	}
	return strings.HasPrefix(ref, "file:") && filepath.IsAbs(strings.TrimPrefix(ref, "file:"))
}
func ResolveSecret(ref string) (string, error) {
	if !validSecretRef(ref) {
		return "", fmt.Errorf("invalid secret reference")
	}
	var v string
	if strings.HasPrefix(ref, "env:") {
		v = os.Getenv(strings.TrimPrefix(ref, "env:"))
	} else {
		b, e := os.ReadFile(strings.TrimPrefix(ref, "file:"))
		if e != nil {
			return "", fmt.Errorf("secret file unavailable")
		}
		v = strings.TrimSpace(string(b))
	}
	if v == "" {
		return "", fmt.Errorf("secret unavailable")
	}
	return v, nil
}
func cloneManifest(m Manifest) Manifest {
	m.Capabilities = append([]string{}, m.Capabilities...)
	m.ConfigurationFields = append([]ConfigurationField{}, m.ConfigurationFields...)
	m.Limitations = append([]string{}, m.Limitations...)
	return m
}
func (r *Registry) Summaries() []Summary {
	out := make([]Summary, len(r.summaries))
	for i, s := range r.summaries {
		s.Manifest = cloneManifest(s.Manifest)
		out[i] = s
	}
	return out
}
func (r *Registry) CreateCheckout(ctx context.Context, in CheckoutRequest) (Checkout, error) {
	if in.InvoiceID == "" || in.OrderID == "" || in.AccountID == "" || in.AmountMinor <= 0 || !currencyCode.MatchString(in.Currency) || in.IdempotencyKey == "" {
		return Checkout{}, ErrInvalidResult
	}
	c, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	out, err := r.payment.CreateCheckout(c, in)
	if err != nil {
		return Checkout{}, err
	}
	if c.Err() != nil {
		return Checkout{}, c.Err()
	}
	u, err := url.Parse(out.URL)
	allowed := false
	if err == nil && u.Scheme == "https" && u.User == nil && u.Port() == "" && u.Fragment == "" {
		for _, h := range r.checkoutHosts {
			if strings.EqualFold(u.Hostname(), h) {
				allowed = true
			}
		}
	}
	if !allowed || out.ProviderID != r.paymentID || out.SessionID == "" || !out.ExpiresAt.After(time.Now()) {
		return Checkout{}, ErrInvalidResult
	}
	return out, nil
}
func (r *Registry) SendEmail(ctx context.Context, m EmailMessage) (EmailReceipt, error) {
	if r.emailID == "email.disabled" {
		return EmailReceipt{}, ErrUnavailable
	}
	address, err := mail.ParseAddress(m.To)
	if err != nil || address.Address != m.To || strings.TrimSpace(m.Template) == "" || strings.TrimSpace(m.IdempotencyKey) == "" {
		return EmailReceipt{}, ErrInvalidResult
	}
	c, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	v, e := r.email.Send(c, m)
	if e != nil {
		return EmailReceipt{}, e
	}
	if c.Err() != nil {
		return EmailReceipt{}, c.Err()
	}
	if strings.TrimSpace(v.ProviderMessageID) == "" {
		return EmailReceipt{}, ErrInvalidResult
	}
	return v, nil
}

// Callback verification is intentionally not routed by the HTTP app yet. A future
// settlement service must persist deduplication and ledger effects atomically.
func (r *Registry) VerifyCallback(ctx context.Context, in CallbackRequest) (VerifiedPayment, error) {
	c, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	v, e := r.payment.VerifyCallback(c, in)
	if e != nil {
		return VerifiedPayment{}, e
	}
	if c.Err() != nil {
		return VerifiedPayment{}, c.Err()
	}
	if v.ProviderID != r.paymentID || v.EventID == "" || v.TransactionID == "" || v.MerchantAccountID == "" || v.AccountID == "" || v.OrderID == "" || v.InvoiceID == "" || v.AmountMinor <= 0 || v.Currency == "" || v.SettledAt.IsZero() || v.Status != "settled" {
		return VerifiedPayment{}, ErrInvalidResult
	}
	return v, nil
}

func nilAdapter(adapter any) bool {
	if adapter == nil {
		return true
	}
	v := reflect.ValueOf(adapter)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	}
	return false
}
