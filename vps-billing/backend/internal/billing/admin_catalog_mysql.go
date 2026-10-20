package billing

import (
	"context"
	"database/sql"
)

const catalogPlanColumns = "id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,available"

func scanCatalogPlan(row interface{ Scan(...any) error }) (CatalogPlan, error) {
	var p CatalogPlan
	p.Prices = []CatalogPrice{}
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.CPU, &p.MemoryGB, &p.DiskGB, &p.TransferTB, &p.Region, &p.Available)
	return p, err
}
func readCatalogPlan(ctx context.Context, q currencyQuerier, id, lock string) (CatalogPlan, error) {
	p, err := scanCatalogPlan(q.QueryRowContext(ctx, "SELECT "+catalogPlanColumns+" FROM plans WHERE id=?"+lock, id))
	if err == sql.ErrNoRows {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	rows, err := q.QueryContext(ctx, "SELECT currency,amount_minor,available FROM plan_prices WHERE plan_id=? ORDER BY currency"+lock, id)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var price CatalogPrice
		if err = rows.Scan(&price.Currency, &price.AmountMinor, &price.Available); err != nil {
			return p, err
		}
		p.Prices = append(p.Prices, price)
	}
	return p, rows.Err()
}
func (m *MySQL) AdminCatalog(ctx context.Context, actor User) (CatalogView, error) {
	tx, err := m.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return CatalogView{}, err
	}
	defer tx.Rollback()
	// The same User -> currency -> plan order as order creation prevents cycles
	// with customer administration. Holding currency S makes both reads one view.
	if _, err = lockActiveAdministrator(ctx, tx, actor.ID); err != nil {
		return CatalogView{}, err
	}
	config, revision, err := readCurrencies(ctx, tx, " FOR SHARE")
	if err != nil {
		return CatalogView{}, err
	}
	out := CatalogView{Revision: revision, CurrencyRevision: config.Revision, Items: []CatalogPlan{}}
	rows, err := tx.QueryContext(ctx, "SELECT "+catalogPlanColumns+" FROM plans ORDER BY id")
	if err != nil {
		return out, err
	}
	indexes := map[string]int{}
	for rows.Next() {
		p, e := scanCatalogPlan(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		indexes[p.ID] = len(out.Items)
		out.Items = append(out.Items, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT plan_id,currency,amount_minor,available FROM plan_prices ORDER BY plan_id,currency")
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var id string
		var price CatalogPrice
		if err = rows.Scan(&id, &price.Currency, &price.AmountMinor, &price.Available); err != nil {
			rows.Close()
			return out, err
		}
		index, ok := indexes[id]
		if !ok {
			rows.Close()
			return out, ErrCatalog
		}
		out.Items[index].Prices = append(out.Items[index].Prices, price)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if err = validateCatalogView(out, config); err != nil {
		return CatalogView{}, err
	}
	return out, tx.Commit()
}
func (m *MySQL) CreateCatalogPlan(ctx context.Context, actor User, input CatalogInput) (CatalogResult, error) {
	return m.mutateCatalog(ctx, actor, "", input, false)
}
func (m *MySQL) UpdateCatalogPlan(ctx context.Context, actor User, id string, input CatalogInput) (CatalogResult, error) {
	if !validCatalogID(id) {
		return CatalogResult{}, ErrNotFound
	}
	return m.mutateCatalog(ctx, actor, id, input, false)
}
func (m *MySQL) DuplicateCatalogPlan(ctx context.Context, actor User, id string, input CatalogDuplicateInput) (CatalogResult, error) {
	if !validCatalogID(id) {
		return CatalogResult{}, ErrNotFound
	}
	return m.mutateCatalog(ctx, actor, id, CatalogInput{Revision: input.Revision, CurrencyRevision: input.CurrencyRevision, Reason: input.Reason}, true)
}
func (m *MySQL) mutateCatalog(ctx context.Context, actor User, id string, input CatalogInput, duplicate bool) (CatalogResult, error) {
	tx, err := m.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return CatalogResult{}, err
	}
	defer tx.Rollback()
	// Authorize the persisted actor under lock before any shared state is changed.
	actor, err = lockActiveAdministrator(ctx, tx, actor.ID)
	if err != nil {
		return CatalogResult{}, err
	}
	if !validCatalogRevisions(input.Revision, input.CurrencyRevision) {
		return CatalogResult{}, ErrCatalog
	}
	config, revision, err := readCurrencies(ctx, tx, " FOR UPDATE")
	if err != nil {
		return CatalogResult{}, err
	}
	if input.Revision != revision || input.CurrencyRevision != config.Revision || revision == MaxMinor {
		return CatalogResult{}, ErrCatalogConflict
	}
	var previous CatalogPlan
	if id != "" {
		previous, err = readCatalogPlan(ctx, tx, id, " FOR UPDATE")
		if err != nil {
			return CatalogResult{}, err
		}
	}
	action := catalogAction(previous.Available, input.Available)
	create := id == "" || duplicate
	if id == "" {
		action = "catalog.created"
	}
	if duplicate {
		input = catalogInputFrom(previous, input.Revision, input.CurrencyRevision, input.Reason)
		input.Available = false
		action = "catalog.duplicated"
	}
	input, next, err := normalizeCatalog(input, config)
	if err != nil {
		return CatalogResult{}, err
	}
	if create {
		id = ID()
		// Legacy columns are not quotations. Existing legacy/history fields are
		// never rewritten by edits, and new prices live only in plan_prices.
		_, err = tx.ExecContext(ctx, "INSERT INTO plans(id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,price_minor,currency,available) VALUES(?,?,?,?,?,?,?,?,0,?,?)", id, input.Name, input.Description, input.CPU, input.MemoryGB, input.DiskGB, input.TransferTB, input.Region, config.DefaultCurrency, input.Available)
	} else {
		_, err = tx.ExecContext(ctx, "UPDATE plans SET name=?,description=?,cpu=?,memory_gb=?,disk_gb=?,transfer_tb=?,region=?,available=? WHERE id=?", input.Name, input.Description, input.CPU, input.MemoryGB, input.DiskGB, input.TransferTB, input.Region, input.Available, id)
	}
	if err != nil {
		return CatalogResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM plan_prices WHERE plan_id=?", id); err != nil {
		return CatalogResult{}, err
	}
	for _, price := range input.Prices {
		if _, err = tx.ExecContext(ctx, "INSERT INTO plan_prices(plan_id,currency,amount_minor,available) VALUES(?,?,?,?)", id, price.Currency, price.AmountMinor, price.Available); err != nil {
			return CatalogResult{}, err
		}
	}
	revision++
	if err = writeCurrencies(ctx, tx, next, revision); err != nil {
		return CatalogResult{}, err
	}
	if err = insertCurrencyAudit(ctx, tx, catalogAudit(actor, action, id, revision, input.Reason)); err != nil {
		return CatalogResult{}, err
	}
	out, err := readCatalogPlan(ctx, tx, id, "")
	if err != nil {
		return CatalogResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogResult{}, err
	}
	return CatalogResult{Revision: revision, CurrencyRevision: next.Revision, Plan: out}, nil
}
