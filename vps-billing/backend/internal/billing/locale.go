package billing

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Accept-Language is a preference, not a financial input. Unsupported language
// tags fall back to Simplified Chinese; currency never follows this header.
func requestLocale(header string) string {
	locale, best := "zh-CN", -1.0
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		tag, q := strings.ToLower(strings.TrimSpace(fields[0])), 1.0
		if len(fields) > 2 {
			continue
		}
		if len(fields) == 2 {
			parameter := strings.TrimSpace(fields[1])
			if !strings.HasPrefix(parameter, "q=") {
				continue
			}
			value, err := strconv.ParseFloat(strings.TrimPrefix(parameter, "q="), 64)
			if err != nil || !(value > 0 && value <= 1) {
				continue
			}
			q = value
		}
		selected := ""
		if tag == "en" || strings.HasPrefix(tag, "en-") {
			selected = "en"
		}
		if tag == "zh" || tag == "zh-cn" || tag == "zh-sg" || tag == "zh-hans" || strings.HasPrefix(tag, "zh-hans-") {
			selected = "zh-CN"
		}
		if selected != "" && q > best {
			locale, best = selected, q
		}
	}
	return locale
}

var englishErrors = map[string]string{
	"INVALID_EMAIL_SETTINGS":       "Check SMTP settings and credentials. Changing the server requires replacing both credentials; clearing requires both credentials and disabling SMTP.",
	"SMTP_DISABLED":                "Save and enable SMTP settings before sending a test.",
	"SMTP_KEY_UNAVAILABLE":         "The SMTP encryption key is unavailable. Contact the server administrator.",
	"SMTP_UNAVAILABLE":             "The SMTP server did not confirm acceptance. Check configuration and server status.",
	"SMTP_DELIVERY_UNCERTAIN":      "Delivery outcome is uncertain. Check SMTP server records before any manual retry.",
	"INTERNAL_ERROR":               "Unable to complete the request. Please try again later.",
	"JSON_REQUIRED":                "Use an application/json request.",
	"INVALID_BODY":                 "Invalid JSON object or unsupported fields.",
	"INVALID_HOST":                 "The request host does not match this site.",
	"NOT_READY":                    "The service is not ready.",
	"NOT_FOUND":                    "The requested resource was not found.",
	"METHOD_NOT_ALLOWED":           "This request method is not supported.",
	"CSRF_INVALID":                 "Your security token is invalid. Refresh the page and try again.",
	"AUTH_REQUIRED":                "Please sign in first.",
	"FORBIDDEN":                    "You do not have permission to perform this action.",
	"INVALID_SETTINGS":             "Check the required fields, language, currency, contact details and HTTPS URLs.",
	"SETTINGS_CONFLICT":            "Another administrator changed these settings. Reload before editing.",
	"RATE_LIMITED":                 "Too many attempts. Please try again later.",
	"INVALID_CREDENTIALS":          "The email address or password is incorrect.",
	"VALIDATION_ERROR":             "Choose a plan and enter a hostname with 1–63 letters, digits or hyphens.",
	"IDEMPOTENCY_KEY_REQUIRED":     "Provide an idempotency key of 8–128 supported characters.",
	"IDEMPOTENCY_CONFLICT":         "This request key was already used for a different order.",
	"PLAN_UNAVAILABLE":             "This plan is not available in the selected currency.",
	"INVALID_CURRENCY":             "Only CNY and USD are supported.",
	"INVOICE_NOT_PAYABLE":          "This invoice cannot be paid in its current state.",
	"PAYMENT_NOT_CONFIGURED":       "Payments are not connected. No charge will be made.",
	"PAYMENT_CURRENCY_UNSUPPORTED": "The payment provider does not support this invoice currency.",
	"PAYMENT_PROVIDER_ERROR":       "Unable to create a payment session. Please try again later.",
}

func (a *App) queryCurrency(w http.ResponseWriter, r *http.Request) (string, bool) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		fail(w, r, 400, "INVALID_CURRENCY", "请检查币种参数，仅支持 CNY 和 USD")
		return "", false
	}
	values, supplied := query["currency"]
	if supplied {
		if len(values) != 1 || !SupportedCurrency(values[0]) {
			fail(w, r, 400, "INVALID_CURRENCY", "仅支持 CNY 和 USD")
			return "", false
		}
		return values[0], true
	}
	settings, err := a.Store.Settings(r.Context())
	if err != nil || !SupportedCurrency(settings.DefaultCurrency) {
		a.internal(w, r, err)
		return "", false
	}
	return settings.DefaultCurrency, true
}

// Operator-authored product text and historical snapshots are never translated
// or rewritten. Only the known in-memory demonstration catalog is localized.
func localizeDemoPlans(plans []Plan) {
	examples := Catalog()
	names := []string{"Starter Cloud", "Standard Cloud", "Performance Cloud"}
	descriptions := []string{"For personal sites and development", "For growing applications", "More compute and storage capacity"}
	for n := range plans {
		for j, example := range examples {
			if plans[n].ID == example.ID {
				if plans[n].Name == example.Name {
					plans[n].Name = names[j]
				}
				if plans[n].Description == example.Description {
					plans[n].Description = descriptions[j]
				}
				if plans[n].Region == example.Region {
					if j == 2 {
						plans[n].Region = "Tokyo · NRT"
					} else {
						plans[n].Region = "Hong Kong · HKG"
					}
				}
			}
		}
	}
}
