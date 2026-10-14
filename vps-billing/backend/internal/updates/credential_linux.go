package updates

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// LoadTokenFile reads an optional private read-only GitHub credential without
// following any symlink. The configured path and token never appear in errors.
func LoadTokenFile(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsAny(path, "\x00\r\n") {
		return "", ErrUnavailable
	}
	fd, err := syscall.Open("/", syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_DIRECTORY, 0)
	if err != nil {
		return "", ErrUnavailable
	}
	defer func() { syscall.Close(fd) }()
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	var before syscall.Stat_t
	for i, part := range parts {
		flags := syscall.O_RDONLY | syscall.O_CLOEXEC | syscall.O_NOFOLLOW | syscall.O_NONBLOCK
		if i < len(parts)-1 {
			flags |= syscall.O_DIRECTORY
		}
		next, err := syscall.Openat(fd, part, flags, 0)
		if err != nil {
			return "", ErrUnavailable
		}
		syscall.Close(fd)
		fd = next
		var stat syscall.Stat_t
		if syscall.Fstat(fd, &stat) != nil {
			return "", ErrUnavailable
		}
		if stat.Uid != 0 && stat.Uid != uint32(os.Geteuid()) {
			return "", ErrUnavailable
		}
		if i < len(parts)-1 {
			if stat.Mode&syscall.S_IFMT != syscall.S_IFDIR || stat.Mode&0022 != 0 && !(stat.Uid == 0 && stat.Mode&syscall.S_ISVTX != 0) {
				return "", ErrUnavailable
			}
		} else if stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Mode&07777 != 0400 || stat.Nlink != 1 || stat.Size < 1 || stat.Size > 4096 {
			return "", ErrUnavailable
		}
		if i == len(parts)-1 {
			before = stat
		}
	}
	dup, err := syscall.Dup(fd)
	if err != nil {
		return "", ErrUnavailable
	}
	file := os.NewFile(uintptr(dup), "release-credential")
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 4097))
	var after syscall.Stat_t
	if err != nil || len(raw) > 4096 || int64(len(raw)) != before.Size || syscall.Fstat(fd, &after) != nil || before.Dev != after.Dev || before.Ino != after.Ino || before.Mode != after.Mode || before.Uid != after.Uid || before.Gid != after.Gid || before.Nlink != after.Nlink || before.Size != after.Size || before.Mtim != after.Mtim || before.Ctim != after.Ctim {
		return "", ErrUnavailable
	}
	token := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	if len(token) < 20 || len(token) > 256 {
		return "", ErrUnavailable
	}
	for _, value := range []byte(token) {
		if value < 33 || value > 126 {
			return "", ErrUnavailable
		}
	}
	return token, nil
}
