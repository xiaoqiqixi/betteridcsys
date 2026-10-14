package main

import (
	"aster/billing/internal/billing"
	"aster/billing/internal/integrations"
	"context"
	"errors"
	"flag"
	"golang.org/x/crypto/bcrypt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func secret(name string) string {
	v := os.Getenv(name)
	if f := os.Getenv(name + "_FILE"); f != "" {
		b, e := os.ReadFile(f)
		if e != nil {
			slog.Error("cannot read secret file", "setting", name)
			os.Exit(1)
		}
		v = strings.TrimSpace(string(b))
	}
	return v
}
func fatal(msg string) { slog.Error(msg); os.Exit(1) }
func validSessionSecret(key string) bool {
	if len(key) < 32 {
		return false
	}
	lower := strings.ToLower(key)
	for _, bad := range []string{"change", "example", "demo", "replace", "password", "your-secret"} {
		if strings.Contains(lower, bad) {
			return false
		}
	}
	seen := map[byte]bool{}
	for i := 0; i < len(key); i++ {
		seen[key[i]] = true
	}
	return len(seen) >= 8
}
func main() {
	migrate := flag.Bool("migrate", false, "Apply embedded MySQL schema; seeds unavailable plans only")
	create := flag.Bool("create-user", false, "Create user from BOOTSTRAP_* environment")
	flag.Parse()
	mode := os.Getenv("APP_MODE")
	demo := mode == "demo"
	if mode != "" && mode != "production" && !demo {
		fatal("APP_MODE must be production or demo")
	}
	origin := os.Getenv("APP_ORIGIN")
	key := secret("SESSION_SECRET")
	listen := os.Getenv("LISTEN_ADDR")
	if listen == "" {
		listen = "127.0.0.1:8080"
	}
	if demo {
		if key == "" {
			key = billing.ID() + billing.ID()
		}
		if origin == "" {
			origin = "http://localhost:5173"
		}
		slog.Warn("DEMO MODE: in-memory data and public example credentials; never expose publicly")
	} else {
		if !validSessionSecret(key) {
			fatal("SESSION_SECRET must be a unique cryptographically random value of at least 32 bytes")
		}
		u, e := url.Parse(origin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			fatal("APP_ORIGIN must be the canonical HTTPS origin without a path")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var store billing.Store
	if demo {
		if *migrate || *create {
			fatal("database commands require production mode")
		}
		store = billing.NewMemory()
	} else {
		dsn := secret("MYSQL_DSN")
		if dsn == "" {
			fatal("MYSQL_DSN is required")
		}
		db, e := billing.OpenMySQL(ctx, dsn, os.Getenv("MYSQL_ALLOW_INSECURE") == "true")
		if e != nil {
			fatal("cannot initialize database; check configuration, TLS and connectivity")
		}
		defer db.DB.Close()
		store = db
		if *migrate {
			if e = db.Migrate(ctx); e != nil {
				fatal("migration failed; inspect database permissions and schema")
			}
			slog.Info("migration completed; default plans remain unavailable until reviewed")
			return
		}
		if *create {
			email := strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_EMAIL")))
			parsed, e := mail.ParseAddress(email)
			if e != nil || parsed.Address != email || strings.HasSuffix(email, "@aster.local") {
				fatal("BOOTSTRAP_EMAIL must be a valid non-demo email")
			}
			password := secret("BOOTSTRAP_PASSWORD")
			if len(password) < 16 || len(password) > 72 || strings.Contains(strings.ToLower(password), "demo") || strings.Contains(strings.ToLower(password), "password") {
				fatal("bootstrap password must be unique, 16–72 bytes, and not an example password")
			}
			role := os.Getenv("BOOTSTRAP_ROLE")
			if role == "" {
				role = "customer"
			}
			if role != "customer" && role != "admin" {
				fatal("BOOTSTRAP_ROLE must be customer or admin")
			}
			name := strings.TrimSpace(os.Getenv("BOOTSTRAP_NAME"))
			if name == "" || len(name) > 120 {
				fatal("BOOTSTRAP_NAME is required, at most 120 bytes")
			}
			h, e := bcrypt.GenerateFromPassword([]byte(password), 12)
			if e != nil {
				fatal("password hashing failed")
			}
			if e = db.AddUser(ctx, billing.User{ID: billing.ID(), Email: email, Name: name, Role: role, PasswordHash: string(h)}); e != nil {
				fatal("user creation failed; email may already exist")
			}
			slog.Info("user created")
			return
		}
	}
	proxyCIDRs := strings.FieldsFunc(os.Getenv("TRUSTED_PROXY_CIDRS"), func(r rune) bool { return r == ',' })
	for _, cidr := range proxyCIDRs {
		if _, _, e := net.ParseCIDR(cidr); e != nil {
			fatal("TRUSTED_PROXY_CIDRS must contain valid comma-separated CIDRs")
		}
	}
	// Installed adapters are compiled into this list. No dynamic code loading.
	integrationConfigs, configErr := integrations.LoadConfigFile(os.Getenv("INTEGRATIONS_CONFIG_FILE"))
	if configErr != nil {
		fatal("invalid integration configuration file; use a bounded JSON object of provider settings and secret references")
	}
	registry, integrationErr := integrations.New(context.Background(), nil, integrations.Options{
		PaymentID: os.Getenv("PAYMENT_PROVIDER"), EmailID: os.Getenv("EMAIL_PROVIDER"), Configs: integrationConfigs,
	})
	if integrationErr != nil {
		fatal("invalid integration configuration; check installed provider IDs and required settings")
	}
	app := billing.NewAppWithIntegrations(store, billing.Config{Demo: demo, Origin: origin, Secret: key, SecureCookie: !demo, TrustedProxyCIDRs: proxyCIDRs}, registry)
	server := &http.Server{Addr: listen, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-stop
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(c)
	}()
	slog.Info("billing API listening", "address", listen, "demo_mode", demo)
	if e := server.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		fatal("HTTP server failed")
	}
}
