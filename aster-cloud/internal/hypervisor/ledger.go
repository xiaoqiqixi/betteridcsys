package hypervisor

import (
	"aster/billing/controllerapi"
	"aster/cloud/internal/nodeproto"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type Instance struct {
	ID        string                  `json:"id"`
	OwnerRef  string                  `json:"owner_ref"`
	Hostname  string                  `json:"hostname"`
	Domain    string                  `json:"domain"`
	Directory string                  `json:"directory"`
	Disk      string                  `json:"disk"`
	Seed      string                  `json:"seed"`
	IPv4      string                  `json:"ipv4"`
	MAC       string                  `json:"mac"`
	State     string                  `json:"state"`
	Resources controllerapi.Resources `json:"resources"`
}
type Operation struct {
	Task      nodeproto.NodeTask   `json:"task"`
	Result    nodeproto.NodeResult `json:"result"`
	CreatedAt string               `json:"created_at"`
	UpdatedAt string               `json:"updated_at"`
	ErrorCode string               `json:"error_code,omitempty"`
}

const maxJournalBytes = 64 << 20

type journal struct {
	Schema     int                  `json:"schema"`
	NodeID     string               `json:"node_id"`
	Operations map[string]Operation `json:"operations"`
	Instances  map[string]Instance  `json:"instances"`
}
type Ledger struct {
	mu        sync.Mutex
	directory string
	lock      *os.File
	state     journal
	closed    bool
	poisoned  bool
}

func OpenLedger(directory, nodeID string) (*Ledger, error) {
	if err := NoSymlinkPath(directory); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	if err := ownedPath(directory, true, true); err != nil {
		return nil, err
	}
	lockPath := filepath.Join(directory, "node.lock")
	if err := NoSymlinkPath(lockPath); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = ownedPath(lockPath, true, false); err != nil {
		lock.Close()
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, errors.New("node already locked")
	}
	l := &Ledger{directory: directory, lock: lock, state: journal{Schema: 1, NodeID: nodeID, Operations: map[string]Operation{}, Instances: map[string]Instance{}}}
	path := filepath.Join(directory, "journal.json")
	if _, err = os.Lstat(path); err == nil {
		if err = ownedPath(path, true, false); err != nil {
			l.Close()
			return nil, err
		}
		raw, e := readApproved(path, true, maxJournalBytes)
		if e != nil {
			l.Close()
			return nil, e
		}
		if len(raw) > maxJournalBytes || json.Unmarshal(raw, &l.state) != nil || l.state.Schema != 1 || l.state.NodeID != nodeID || l.state.Operations == nil || l.state.Instances == nil {
			l.Close()
			return nil, errors.New("invalid journal")
		}
	} else if !os.IsNotExist(err) {
		l.Close()
		return nil, err
	}
	if err = l.validateLoaded(); err != nil {
		l.Close()
		return nil, err
	}
	// A previous accepted claim might already have affected libvirt. Never rerun it.
	for id, op := range l.state.Operations {
		if op.Result.Status == "accepted" {
			op.Result.Status = "uncertain"
			op.ErrorCode = "INTERRUPTED_AFTER_CLAIM"
			op.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			l.state.Operations[id] = op
		}
	}
	if err = l.save(); err != nil {
		l.Close()
		return nil, err
	}
	return l, nil
}
func (l *Ledger) save() error {
	if l.closed || l.poisoned {
		return errors.New("journal unavailable")
	}
	raw, err := json.Marshal(l.state)
	if err != nil {
		return err
	}
	if len(raw) > maxJournalBytes {
		l.poisoned = true
		return errors.New("journal capacity reached; operator action required")
	}
	tmp, err := os.CreateTemp(l.directory, ".journal-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(raw)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, filepath.Join(l.directory, "journal.json"))
	}
	if err == nil {
		d, e := os.Open(l.directory)
		if e != nil {
			err = e
		} else {
			err = d.Sync()
			d.Close()
		}
	}
	if err != nil {
		l.poisoned = true
	}
	return err
}
func (l *Ledger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	syscall.Flock(int(l.lock.Fd()), syscall.LOCK_UN)
	return l.lock.Close()
}
func (l *Ledger) Claim(task nodeproto.NodeTask, sha string) (nodeproto.NodeResult, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || l.poisoned {
		return nodeproto.NodeResult{}, false, errors.New("journal unavailable")
	}
	if op, ok := l.state.Operations[task.OperationID]; ok {
		if op.Result.RequestSHA256 != sha {
			return nodeproto.NodeResult{}, false, ErrConflict
		}
		return op.Result, false, nil
	}
	result := nodeproto.NodeResult{Protocol: nodeproto.Protocol, OperationID: task.OperationID, RequestSHA256: sha, InstanceID: task.InstanceID, Status: "accepted"}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	l.state.Operations[task.OperationID] = Operation{Task: task, Result: result, CreatedAt: now, UpdatedAt: now}
	return result, true, l.save()
}
func (l *Ledger) Reserve(instance Instance) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.state.Instances[instance.ID]; ok {
		return ErrConflict
	}
	for _, existing := range l.state.Instances {
		if instance.IPv4 != "" && existing.IPv4 == instance.IPv4 && existing.State != "deleted" {
			return ErrConflict
		}
	}
	l.state.Instances[instance.ID] = instance
	return l.save()
}
func (l *Ledger) Finish(id, status, code string, instance *Instance) (nodeproto.NodeResult, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	op, ok := l.state.Operations[id]
	if !ok {
		return nodeproto.NodeResult{}, ErrNotFound
	}
	op.Result.Status = status
	op.ErrorCode = code
	op.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	l.state.Operations[id] = op
	if instance != nil {
		l.state.Instances[instance.ID] = *instance
	}
	err := l.save()
	if err != nil {
		op.Result.Status = "uncertain"
		op.ErrorCode = "JOURNAL_WRITE_UNCERTAIN"
		l.state.Operations[id] = op
	}
	return op.Result, err
}
func (l *Ledger) Query(id string) (Operation, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	op, ok := l.state.Operations[id]
	return op, ok
}
func (l *Ledger) Instances() []Instance {
	l.mu.Lock()
	defer l.mu.Unlock()
	items := make([]Instance, 0, len(l.state.Instances))
	for _, item := range l.state.Instances {
		items = append(items, item)
	}
	return items
}
func (l *Ledger) Instance(id string) (Instance, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	item, ok := l.state.Instances[id]
	return item, ok
}

func (l *Ledger) validateLoaded() error {
	ips := map[string]bool{}
	for id, op := range l.state.Operations {
		if id != op.Task.OperationID || !op.Result.Matches(op.Task, op.Result.RequestSHA256) || op.Task.NodeID != l.state.NodeID {
			return errors.New("invalid journal operation identity")
		}
		if _, e := time.Parse(time.RFC3339Nano, op.CreatedAt); e != nil {
			return errors.New("invalid journal timestamp")
		}
	}
	for id, i := range l.state.Instances {
		if !nodeproto.ValidID(id) || i.ID != id || !nodeproto.ValidID(i.OwnerRef) || i.Domain != "aster-"+id || filepath.Base(i.Directory) != i.Domain || !filepath.IsAbs(i.Directory) || i.Disk != filepath.Join(i.Directory, "system.qcow2") || (i.Seed != "" && i.Seed != filepath.Join(i.Directory, "seed.iso")) {
			return errors.New("invalid journal instance identity")
		}
		switch i.State {
		case "reserved", "uncertain", "running", "shut off", "deleted":
		default:
			return errors.New("invalid journal instance state")
		}
		if i.State != "deleted" && i.IPv4 != "" {
			if ips[i.IPv4] {
				return errors.New("duplicate journal IP reservation")
			}
			ips[i.IPv4] = true
		}
	}
	return nil
}
