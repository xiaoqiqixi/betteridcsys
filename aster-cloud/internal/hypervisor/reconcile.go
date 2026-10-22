package hypervisor

import (
	"aster/cloud/internal/nodeproto"
	"context"
	"errors"
)

// Reconcile only observes the original domain; it never repeats a libvirt write.
// Intended for the root-only CLI while the service is stopped (exclusive journal).
func (m *Manager) Reconcile(ctx context.Context, id string) (nodeproto.NodeResult, error) {
	if !nodeproto.ValidID(id) {
		return nodeproto.NodeResult{}, nodeproto.ErrInvalid
	}
	m.admission.Lock()
	defer m.admission.Unlock()
	if m.active {
		return nodeproto.NodeResult{}, errors.New("worker active; reconciliation refused")
	}
	op, ok := m.Ledger.Query(id)
	if !ok {
		return nodeproto.NodeResult{}, ErrNotFound
	}
	if op.Result.Status != "accepted" && op.Result.Status != "uncertain" {
		return op.Result, errors.New("only accepted/uncertain operations can be reconciled")
	}
	instance, ok := m.Ledger.Instance(op.Task.InstanceID)
	if !ok || instance.OwnerRef != op.Task.OwnerRef || instance.Resources != op.Task.Resources || instance.Hostname != op.Task.Hostname {
		return op.Result, ErrOwnership
	}
	if op.Task.Action == "reboot" || op.Task.Action == "delete" {
		return op.Result, errors.New("read-only observation cannot prove reboot/delete completion")
	}
	if err := m.assertOwned(ctx, instance); err != nil {
		return op.Result, err
	}
	state, err := m.state(ctx, instance.Domain)
	if err != nil {
		return op.Result, err
	}
	desired := "running"
	switch op.Task.Action {
	case "create", "start":
	case "shutdown", "force_off":
		desired = "shut off"
	default:
		return op.Result, ErrUnsupported
	}
	if state != desired {
		return op.Result, errors.New("observed state does not prove requested outcome")
	}
	instance.State = desired
	return m.Ledger.Finish(id, "succeeded", "READONLY_RECONCILED_FROM_"+op.Result.Status, &instance)
}
