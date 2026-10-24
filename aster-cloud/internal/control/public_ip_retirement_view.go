package control

import (
	"aster/cloud/internal/nodeproto"
	"context"
	"errors"
)

func (c Console) retirementView(ctx context.Context, m *Migration) error {
	prepare, e := c.Store.Operation(ctx, m.SourceOperationID)
	if e != nil {
		return e
	}
	if prepare.Protocol != nodeproto.StorageDirectProtocol || m.Phase != "active" {
		return nil
	}
	m.SourceRetirementState = "required"
	o, e := scanOperation(c.Store.DB.QueryRowContext(ctx, "SELECT "+operationColumns+" FROM controller_operations WHERE artifact_id=? AND instance_id=? AND action='migrate_retire_source' ORDER BY seq DESC LIMIT 1", m.ID, m.InstanceID))
	if errors.Is(e, ErrNotFound) {
		return nil
	}
	if e != nil {
		return e
	}
	m.SourceRetirementOperationID = o.ID
	switch o.State {
	case "succeeded":
		m.SourceRetirementState = "succeeded"
	case "accepted":
		m.SourceRetirementState = "pending"
	case "rejected":
		m.SourceRetirementState = "required"
	default:
		m.SourceRetirementState = "blocked"
	}
	return nil
}
