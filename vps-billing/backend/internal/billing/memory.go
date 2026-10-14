package billing

import (
	"context"
	"golang.org/x/crypto/bcrypt"
	"sync"
	"time"
)

type memoRequest struct {
	Fingerprint string
	Order       Order
}
type Memory struct {
	mu       sync.Mutex
	users    map[string]User
	sessions map[string]Session
	plans    []Plan
	orders   []Order
	invoices []Invoice
	services []Service
	audits   []Audit
	requests map[string]memoRequest
}

func NewMemory() *Memory {
	m := &Memory{users: map[string]User{}, sessions: map[string]Session{}, plans: Catalog(), orders: []Order{}, invoices: []Invoice{}, services: []Service{}, audits: []Audit{}, requests: map[string]memoRequest{}}
	for _, v := range []struct{ email, name, role, password string }{{"demo@aster.local", "林先生", "customer", "DemoCustomer!2026"}, {"admin@aster.local", "演示管理员", "admin", "DemoAdmin!2026"}, {"other@aster.local", "另一位客户", "customer", "DemoOther!2026"}} {
		h, _ := bcrypt.GenerateFromPassword([]byte(v.password), bcrypt.DefaultCost)
		u := User{ID: ID(), Email: v.email, Name: v.name, Role: v.role, PasswordHash: string(h)}
		m.users[u.ID] = u
	}
	return m
}
func (m *Memory) Ping(context.Context) error { return nil }
func (m *Memory) UserByEmail(_ context.Context, e string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.Email == e {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}
func (m *Memory) UserByID(_ context.Context, id string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return u, ErrNotFound
	}
	return u, nil
}
func (m *Memory) AddUser(_ context.Context, u User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, v := range m.users {
		if v.Email == u.Email {
			return ErrConflict
		}
	}
	m.users[u.ID] = u
	return nil
}
func (m *Memory) Users(context.Context) ([]User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := []User{}
	for _, u := range m.users {
		r = append(r, u)
	}
	return r, nil
}
func (m *Memory) PutSession(_ context.Context, s Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, v := range m.sessions {
		if v.Expires.Before(time.Now()) {
			delete(m.sessions, k)
		}
	}
	m.sessions[s.Hash] = s
	return nil
}
func (m *Memory) Session(_ context.Context, k string) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[k]
	if !ok || s.Expires.Before(time.Now()) {
		return Session{}, ErrNotFound
	}
	return s, nil
}
func (m *Memory) DeleteSession(_ context.Context, k string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, k)
	return nil
}
func (m *Memory) Plans(context.Context) ([]Plan, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Plan{}, m.plans...), nil
}
func (m *Memory) Orders(_ context.Context, uid string) ([]Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := []Order{}
	for j := len(m.orders) - 1; j >= 0; j-- {
		v := m.orders[j]
		if uid == "" || v.UserID == uid {
			r = append(r, v)
		}
	}
	return r, nil
}
func (m *Memory) Invoices(_ context.Context, uid string) ([]Invoice, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := []Invoice{}
	for j := len(m.invoices) - 1; j >= 0; j-- {
		v := m.invoices[j]
		if uid == "" || v.UserID == uid {
			r = append(r, v)
		}
	}
	return r, nil
}
func (m *Memory) Services(_ context.Context, uid string) ([]Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := []Service{}
	for _, v := range m.services {
		if uid == "" || v.UserID == uid {
			r = append(r, v)
		}
	}
	return r, nil
}
func (m *Memory) Audits(_ context.Context, uid string) ([]Audit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := []Audit{}
	for j := len(m.audits) - 1; j >= 0; j-- {
		v := m.audits[j]
		if uid == "" || v.UserID == uid {
			r = append(r, v)
		}
	}
	return r, nil
}
func (m *Memory) CreateOrder(_ context.Context, u User, pid, host, key, fp string) (Order, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := u.ID + ":" + key
	if r, ok := m.requests[k]; ok {
		if r.Fingerprint != fp {
			return Order{}, false, ErrConflict
		}
		return r.Order, true, nil
	}
	var p Plan
	for _, v := range m.plans {
		if v.ID == pid {
			p = v
		}
	}
	if !p.Available {
		return Order{}, false, ErrUnavailable
	}
	o, i, a := newRecords(u, p, host)
	m.orders = append(m.orders, o)
	m.invoices = append(m.invoices, i)
	m.audits = append(m.audits, a)
	m.requests[k] = memoRequest{fp, o}
	return o, false, nil
}

func (m *Memory) Invoice(c context.Context, uid, id string) (Invoice, error) {
	vs, e := m.Invoices(c, uid)
	if e != nil {
		return Invoice{}, e
	}
	for _, v := range vs {
		if v.ID == id {
			return v, nil
		}
	}
	return Invoice{}, ErrNotFound
}
func (m *Memory) Summary(_ context.Context, uid string) (Summary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out Summary
	for _, s := range m.services {
		if uid != "" && uid != s.UserID {
			continue
		}
		out.TotalServices++
		if s.Status == "active" {
			out.ActiveServices++
			out.MonthlyTotal += s.PriceMinor
		}
	}
	for _, i := range m.invoices {
		if uid != "" && uid != i.UserID {
			continue
		}
		if i.Status == "unpaid" {
			out.PendingInvoices++
		}
		if i.Status == "paid" {
			out.Revenue += i.AmountMinor
		}
	}
	for _, u := range m.users {
		if u.Role == "customer" {
			out.Customers++
		}
	}
	return out, nil
}
