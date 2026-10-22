package nodeproto

import (
	"aster/billing/controllerapi"
	"bytes"
	"encoding/json"
	"io"
)

const StorageProtocol = "aster.node.storage/1"

// TypedStorageTask contains identifiers and exact manifest/fence bindings only.
// Every field is required, including explicitly empty irrelevant fields. There
// is intentionally no URL, filesystem path, remote command, or source_fenced bool.
type TypedStorageTask struct {
	Protocol          string `json:"protocol"`
	OperationID       string `json:"operation_id"`
	NodeID            string `json:"node_id"`
	Action            string `json:"action"`
	InstanceID        string `json:"instance_id"`
	OwnerRef          string `json:"owner_ref"`
	ArtifactID        string `json:"artifact_id"`
	TargetNodeID      string `json:"target_node_id"`
	SourceNodeID      string `json:"source_node_id"`
	SourceOperationID string `json:"source_operation_id"`
	ManifestSHA256    string `json:"manifest_sha256"`
	FenceToken        string `json:"fence_token"`
	ConfirmArtifactID string `json:"confirm_artifact_id"`
}

type StorageArtifact struct {
	ArtifactID     string `json:"artifact_id"`
	Kind           string `json:"kind"`
	NodeID         string `json:"node_id"`
	InstanceID     string `json:"instance_id"`
	OwnerRef       string `json:"owner_ref"`
	ManifestSHA256 string `json:"manifest_sha256"`
	DiskSHA256     string `json:"disk_sha256"`
	DiskBytes      int64  `json:"disk_bytes"`
	VirtualBytes   uint64 `json:"virtual_bytes"`
	CreatedAt      string `json:"created_at"`
	State          string `json:"state"`
}

type StorageResult struct {
	Protocol       string            `json:"protocol"`
	OperationID    string            `json:"operation_id"`
	RequestSHA256  string            `json:"request_sha256"`
	Status         string            `json:"status"`
	InstanceID     string            `json:"instance_id"`
	ArtifactID     string            `json:"artifact_id"`
	ManifestSHA256 string            `json:"manifest_sha256"`
	FenceToken     string            `json:"fence_token"`
	SourceNodeID   string            `json:"source_node_id"`
	TargetNodeID   string            `json:"target_node_id"`
	Items          []StorageArtifact `json:"items"`
}

// StorageManifest is canonical JSON signed with the source node's approved TLS
// key for migration. Disk is always a flat qcow2, no external backing/data file.
// XML is never imported: the target reconstructs it from its own approvals.
type StorageManifest struct {
	Protocol          string                  `json:"protocol"`
	ArtifactID        string                  `json:"artifact_id"`
	Kind              string                  `json:"kind"`
	NodeID            string                  `json:"node_id"`
	InstanceID        string                  `json:"instance_id"`
	OwnerRef          string                  `json:"owner_ref"`
	Hostname          string                  `json:"hostname"`
	Resources         controllerapi.Resources `json:"resources"`
	SourceDomain      string                  `json:"source_domain"`
	ImageID           string                  `json:"image_id"`
	ImageSHA256       string                  `json:"image_sha256"`
	DiskSHA256        string                  `json:"disk_sha256"`
	DiskBytes         int64                   `json:"disk_bytes"`
	VirtualBytes      uint64                  `json:"virtual_bytes"`
	CreatedAt         string                  `json:"created_at"`
	ExportOperationID string                  `json:"export_operation_id"`
	TargetNodeID      string                  `json:"target_node_id"`
	FenceToken        string                  `json:"fence_token"`
}

type SignedStorageManifest struct {
	Manifest       StorageManifest `json:"manifest"`
	CertificateDER string          `json:"certificate_der"`
	Signature      string          `json:"signature"`
}

func (t TypedStorageTask) Valid() bool {
	if t.Protocol != StorageProtocol || !ValidID(t.OperationID) || !ValidNodeID(t.NodeID) || !ValidID(t.InstanceID) || !ValidID(t.OwnerRef) {
		return false
	}
	noMigration := t.TargetNodeID == "" && t.SourceNodeID == "" && t.SourceOperationID == "" && t.ManifestSHA256 == "" && t.FenceToken == ""
	switch t.Action {
	case "snapshot_list", "backup_list":
		return noMigration && t.ArtifactID == "" && t.ConfirmArtifactID == ""
	case "snapshot_create", "backup_create", "backup_verify":
		return noMigration && ValidID(t.ArtifactID) && t.ConfirmArtifactID == ""
	case "snapshot_restore", "snapshot_delete", "backup_restore", "backup_delete":
		return noMigration && ValidID(t.ArtifactID) && t.ConfirmArtifactID == t.ArtifactID
	case "migrate_prepare":
		return ValidID(t.ArtifactID) && ValidNodeID(t.TargetNodeID) && t.TargetNodeID != t.NodeID && t.SourceNodeID == "" && t.SourceOperationID == "" && t.ManifestSHA256 == "" && t.FenceToken == "" && t.ConfirmArtifactID == ""
	case "migrate_import", "migrate_activate":
		if !ValidID(t.ArtifactID) || !ValidNodeID(t.SourceNodeID) || t.SourceNodeID == t.NodeID || t.TargetNodeID != t.NodeID || !ValidID(t.SourceOperationID) || !digest.MatchString(t.ManifestSHA256) || !digest.MatchString(t.FenceToken) {
			return false
		}
		if t.Action == "migrate_activate" {
			return t.ConfirmArtifactID == t.ArtifactID
		}
		return t.ConfirmArtifactID == ""
	}
	return false
}
func (t TypedStorageTask) BytesAndDigest() ([]byte, string, error) {
	if !t.Valid() {
		return nil, "", ErrInvalid
	}
	raw, e := json.Marshal(t)
	if e != nil {
		return nil, "", e
	}
	return raw, Digest(raw), nil
}
func (r StorageResult) Matches(t TypedStorageTask, sha string) bool {
	if !t.Valid() || !digest.MatchString(sha) || r.Protocol != StorageProtocol || r.OperationID != t.OperationID || r.RequestSHA256 != sha || r.InstanceID != t.InstanceID || r.ArtifactID != t.ArtifactID {
		return false
	}
	switch r.Status {
	case "accepted", "succeeded", "rejected", "uncertain":
		return true
	}
	return false
}
func DecodeStorageTask(raw []byte) (TypedStorageTask, error) {
	var task TypedStorageTask
	if len(raw) == 0 || len(raw) > 65536 || !uniqueFields(raw) {
		return task, ErrInvalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return task, ErrInvalid
	}
	keys := []string{"protocol", "operation_id", "node_id", "action", "instance_id", "owner_ref", "artifact_id", "target_node_id", "source_node_id", "source_operation_id", "manifest_sha256", "fence_token", "confirm_artifact_id"}
	if len(fields) != len(keys) {
		return task, ErrInvalid
	}
	for _, k := range keys {
		v, ok := fields[k]
		if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return task, ErrInvalid
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&task) != nil || d.Decode(new(any)) != io.EOF || !task.Valid() {
		return TypedStorageTask{}, ErrInvalid
	}
	return task, nil
}

// StorageInboxApprovalTask is accepted only over the pinned controller mTLS
// identity AND an explicit root AllowControllerInboxApproval opt-in. It never
// defines or starts a VM. The target independently verifies signed source proof.
type StorageInboxApprovalTask struct {
	Protocol          string `json:"protocol"`
	TransferID        string `json:"transfer_id"`
	ArtifactID        string `json:"artifact_id"`
	NodeID            string `json:"node_id"`
	InstanceID        string `json:"instance_id"`
	OwnerRef          string `json:"owner_ref"`
	SourceNodeID      string `json:"source_node_id"`
	SourceOperationID string `json:"source_operation_id"`
	TargetNodeID      string `json:"target_node_id"`
	ManifestSHA256    string `json:"manifest_sha256"`
	FenceToken        string `json:"fence_token"`
}

func (t StorageInboxApprovalTask) Valid() bool {
	return t.Protocol == StorageProtocol && ValidID(t.TransferID) && ValidID(t.ArtifactID) && ValidID(t.InstanceID) && ValidID(t.OwnerRef) && ValidNodeID(t.NodeID) && t.TargetNodeID == t.NodeID && ValidNodeID(t.SourceNodeID) && t.SourceNodeID != t.NodeID && ValidID(t.SourceOperationID) && digest.MatchString(t.ManifestSHA256) && digest.MatchString(t.FenceToken)
}

type StorageFileReceipt struct {
	Protocol          string `json:"protocol"`
	NodeID            string `json:"node_id"`
	TransferID        string `json:"transfer_id"`
	ArtifactID        string `json:"artifact_id"`
	File              string `json:"file"`
	SHA256            string `json:"sha256"`
	Bytes             int64  `json:"bytes"`
	Status            string `json:"status"`
	ManifestSHA256    string `json:"manifest_sha256"`
	SourceNodeID      string `json:"source_node_id"`
	SourceOperationID string `json:"source_operation_id"`
	InstanceID        string `json:"instance_id"`
	OwnerRef          string `json:"owner_ref"`
	FenceToken        string `json:"fence_token"`
	TargetNodeID      string `json:"target_node_id"`
}

const InstanceProtocol = "aster.node.instance/1"

type InstanceObservation struct {
	Protocol      string `json:"protocol"`
	NodeID        string `json:"node_id"`
	InstanceID    string `json:"instance_id"`
	OwnerRef      string `json:"owner_ref"`
	Hostname      string `json:"hostname"`
	State         string `json:"state"`
	IPv4          string `json:"ipv4"`
	MAC           string `json:"mac"`
	ObservedAt    string `json:"observed_at"`
	SourceFenced  bool   `json:"source_fenced"`
	TargetPending bool   `json:"target_pending"`
}
