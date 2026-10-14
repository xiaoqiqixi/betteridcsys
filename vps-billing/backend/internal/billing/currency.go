package billing

import "encoding/json"

// Keep omitted currency distinct from an explicit selection. An omitted value
// resolves only for a new order, so a retry survives a changed site default.
// Omitting the field also preserves fingerprints written before currency support.
func orderFingerprint(plan, hostname, currency string) string {
	raw, _ := json.Marshal(struct {
		PlanID   string `json:"plan_id"`
		Hostname string `json:"hostname"`
		Currency string `json:"currency,omitempty"`
	}{plan, hostname, currency})
	return digest(string(raw))
}

func validAmount(amount int64) bool { return amount > 0 && amount <= MaxMinor }

func addAmount(total *int64, amount int64) bool {
	if amount < 0 || amount > MaxMinor || *total > MaxMinor-amount {
		return false
	}
	*total += amount
	return true
}
