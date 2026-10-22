// aster-node is a local KVM/libvirt host executor, not an SSH command relay.
package main

import (
	"aster/cloud/internal/hypervisor"
	"aster/cloud/internal/nodeproto"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "aster-node:", err)
		os.Exit(1)
	}
}

type options struct {
	config            string
	doctor            bool
	reconcile         string
	reconcileProvided bool
}

// parseArgs is side-effect free. An explicitly empty/invalid reconcile flag may
// never be reinterpreted as default serve mode or reach configuration/I/O.
func parseArgs(args []string) (options, error) {
	var o options
	flags := flag.NewFlagSet("aster-node", flag.ContinueOnError)
	flags.StringVar(&o.config, "config", "/etc/aster-node/node.json", "root-owned 0600 configuration")
	flags.StringVar(&o.reconcile, "reconcile-operation", "", "root-only read-only original-domain observation; service must be stopped")
	flags.BoolVar(&o.doctor, "doctor", false, "read-only host readiness check; no mutation")
	if err := flags.Parse(args); err != nil {
		return o, err
	}
	doctorProvided := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "reconcile-operation" {
			o.reconcileProvided = true
		}
		if f.Name == "doctor" {
			doctorProvided = true
		}
	})
	if flags.NArg() != 0 {
		return o, fmt.Errorf("unexpected arguments")
	}
	if o.reconcileProvided && doctorProvided {
		return o, fmt.Errorf("doctor and reconcile are mutually exclusive")
	}
	if o.reconcileProvided && !nodeproto.ValidID(o.reconcile) {
		return o, fmt.Errorf("reconcile requires a 32 lowercase hex operation ID")
	}
	return o, nil
}
func run() error {
	o, err := parseArgs(os.Args[1:])
	if err != nil {
		return err
	}
	cfg, err := hypervisor.LoadConfig(o.config)
	if err != nil {
		return fmt.Errorf("configuration rejected")
	}
	manager := &hypervisor.Manager{Config: cfg, Runner: hypervisor.OSRunner{}}
	if o.doctor {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		report := manager.Doctor(ctx)
		_ = json.NewEncoder(os.Stdout).Encode(report)
		if !report.Ready {
			return fmt.Errorf("host doctor prerequisites not ready")
		}
		return nil
	}
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" || os.Geteuid() != 0 {
		return fmt.Errorf("serve requires native x86_64 Linux root for the approved local libvirt system")
	}
	syscall.Umask(0077)
	ledger, err := hypervisor.OpenLedger(cfg.StateDirectory, cfg.NodeID)
	if err != nil {
		return fmt.Errorf("private journal unavailable")
	}
	defer ledger.Close()
	defer manager.Shutdown()
	manager.Ledger = ledger
	if o.reconcileProvided {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		result, e := manager.Reconcile(ctx, o.reconcile)
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return e
	}
	tlsConfig, err := hypervisor.ServerTLS(cfg)
	if err != nil {
		return fmt.Errorf("mTLS configuration rejected")
	}
	listener, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: manager.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 30 * time.Second, TLSConfig: tlsConfig}
	signals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-signals.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	err = server.Serve(tls.NewListener(listener, tlsConfig))
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
