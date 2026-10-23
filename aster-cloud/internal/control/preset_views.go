package control

import "aster/billing/controllerapi"

// Root approval selectors are not a new browser-editable DTO. Keep the existing
// three-field preset projection when private configuration gains policy fields.
type presetView struct {
	ID        string                  `json:"id"`
	NodeID    string                  `json:"node_id"`
	Resources controllerapi.Resources `json:"resources"`
}

func publicPresets(presets []Preset) []presetView {
	out := make([]presetView, len(presets))
	for i, p := range presets {
		out[i] = presetView{p.ID, p.NodeID, p.Resources}
	}
	return out
}
