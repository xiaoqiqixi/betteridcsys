//go:build linux && amd64

// The host runs as the dedicated plugin service UID, never as root or API UID.
package main

import (
	"aster/billing/internal/runtimeplugins"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"syscall"
)

func main() {
	root := flag.String("root", "", "Protected installed plugin directory")
	policy := flag.String("policy", "", "Root-owned explicit plugin policy")
	flag.Parse()
	if flag.NArg() != 0 || os.Geteuid() == 0 {
		stop()
	}
	approved, err := runtimeplugins.OpenApproved(*root, *policy)
	if err != nil {
		stop()
	}
	defer approved.Close()
	if approved.Selection.WorkerUID != uint32(os.Geteuid()) || approved.Selection.ClientUID == uint32(os.Geteuid()) {
		stop()
	}
	targets, err := json.Marshal(approved.Selection.AllowedTargets)
	if err != nil {
		stop()
	}
	// The verified descriptor pins the exact inode across rename/replacement.
	// No inherited application environment or additional descriptors are passed.
	if err = syscall.Setrlimit(syscall.RLIMIT_CORE, &syscall.Rlimit{}); err != nil {
		stop()
	}
	if err = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &syscall.Rlimit{Cur: 64, Max: 64}); err != nil {
		stop()
	}
	const prSetNoNewPrivs = 38
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, prSetNoNewPrivs, 1, 0, 0, 0, 0); errno != 0 {
		stop()
	}
	// Linux amd64 close_range(CLOEXEC), available since Linux 5.11, atomically
	// prevents inherited non-CLOEXEC descriptors from reaching the plugin. The
	// verified executable stays open until the ELF exec resolves /proc/self/fd.
	const sysCloseRange, closeRangeCloexec = 436, 1 << 2
	if _, _, errno := syscall.Syscall(sysCloseRange, 3, uintptr(^uint32(0)), closeRangeCloexec); errno != 0 {
		stop()
	}
	syscall.Umask(0077)
	executable := "/proc/self/fd/" + strconv.Itoa(int(approved.Executable.Fd()))
	args := []string{"plugin", "--socket", approved.Selection.Socket, "--client-uid", strconv.FormatUint(uint64(approved.Selection.ClientUID), 10), "--targets", string(targets)}
	if syscall.Exec(executable, args, []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC", "TMPDIR=/tmp"}) != nil {
		stop()
	}
}

func stop() {
	fmt.Fprintln(os.Stderr, "Plugin startup rejected; inspect approved installation and policy.")
	os.Exit(1)
}
