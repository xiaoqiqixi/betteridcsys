// Package pluginapi specifies the bounded Unix-socket protocol for runtime plugins.
// It has no dependency on billing storage, secrets, or the SMTP implementation.
package pluginapi

import (
	"aster/billing/pkg/pluginapi/smtpv1"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	CoreVersion    = "0.4.0"
	SMTPProtocol   = "aster.smtp/1"
	SMTPCapability = "smtp.send"
	// JSON can expand a valid 64 KiB plain-text message up to sixfold. Include
	// bounded configuration and envelope overhead without rejecting valid text.
	MaxRequestBytes  = 512 << 10
	MaxResponseBytes = 8 << 10
	MaxManifestBytes = 8 << 10
	MaxPolicyBytes   = 16 << 10
)

var ErrInvalid = errors.New("invalid plugin data")
var identifier = regexp.MustCompile(`^email\.[a-z][a-z0-9-]{0,47}$`)
var digest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var release = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)

type Manifest struct {
	Schema           int      `json:"schema"`
	ID               string   `json:"id"`
	Version          string   `json:"version"`
	Protocol         string   `json:"protocol"`
	CoreMin          string   `json:"core_min"`
	CoreMaxExclusive string   `json:"core_max_exclusive"`
	Capabilities     []string `json:"capabilities"`
	Executable       string   `json:"executable"`
	SHA256           string   `json:"sha256"`
}

type Target struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// Policy contains no credentials. Only the host administrator can update it.
type Policy struct {
	Schema   int        `json:"schema"`
	Revision uint64     `json:"revision"`
	SMTP     *Selection `json:"smtp,omitempty"`
}

type Selection struct {
	Enabled        bool     `json:"enabled"`
	ID             string   `json:"id"`
	Version        string   `json:"version"`
	ManifestSHA256 string   `json:"manifest_sha256"`
	WorkerUID      uint32   `json:"worker_uid"`
	ClientUID      uint32   `json:"client_uid"`
	Socket         string   `json:"socket"`
	AllowedTargets []Target `json:"allowed_targets"`
}

type Hello struct {
	Protocol    string `json:"protocol"`
	CoreVersion string `json:"core_version"`
	Nonce       string `json:"nonce"`
}

type Identity struct {
	Protocol     string   `json:"protocol"`
	ID           string   `json:"id"`
	Version      string   `json:"version"`
	SHA256       string   `json:"sha256"`
	Capabilities []string `json:"capabilities"`
	Nonce        string   `json:"nonce"`
}

type SendRequest struct {
	Protocol  string         `json:"protocol"`
	Version   string         `json:"version"`
	RequestID string         `json:"request_id"`
	TimeoutMS int64          `json:"timeout_ms"`
	Config    smtpv1.Config  `json:"config"`
	Message   smtpv1.Message `json:"message"`
}

type SendResponse struct {
	Protocol          string `json:"protocol"`
	RequestID         string `json:"request_id"`
	Status            string `json:"status"`
	Code              string `json:"code"`
	DeliveryUncertain bool   `json:"delivery_uncertain"`
}

func ValidID(value string) bool      { return identifier.MatchString(value) }
func ValidVersion(value string) bool { return release.MatchString(value) }
func ValidDigest(value string) bool  { return digest.MatchString(value) }

func CompareVersion(a, b string) (int, error) {
	if !ValidVersion(a) || !ValidVersion(b) {
		return 0, ErrInvalid
	}
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := range x {
		left, _ := strconv.Atoi(x[i])
		right, _ := strconv.Atoi(y[i])
		if left < right {
			return -1, nil
		}
		if left > right {
			return 1, nil
		}
	}
	return 0, nil
}

func (m Manifest) Validate(core string) error {
	if m.Schema != 1 || !ValidID(m.ID) || !ValidVersion(m.Version) || m.Protocol != SMTPProtocol || m.Executable != "plugin" || !ValidDigest(m.SHA256) || len(m.Capabilities) != 1 || m.Capabilities[0] != SMTPCapability {
		return ErrInvalid
	}
	minimum, a := CompareVersion(core, m.CoreMin)
	maximum, b := CompareVersion(core, m.CoreMaxExclusive)
	if a != nil || b != nil || minimum < 0 || maximum >= 0 {
		return ErrInvalid
	}
	return nil
}

func Allowed(targets []Target, cfg smtpv1.Config) bool {
	for _, target := range targets {
		if target.Host == cfg.Host && target.Port == cfg.Port {
			return true
		}
	}
	return false
}

// DecodeStrict rejects duplicate/case-aliased keys, nulls, unknown fields,
// non-UTF8 input, trailing JSON and excessive nesting before typed decoding.
func DecodeStrict(raw []byte, limit int, destination any) error {
	if len(raw) == 0 || len(raw) > limit || !utf8.Valid(raw) {
		return ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := scanValue(decoder, 0); err != nil {
		return ErrInvalid
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrInvalid
	}
	// A successful side-effect response must explicitly state its outcome. Go's
	// zero values must not turn an incomplete envelope into an accepted result.
	if _, response := destination.(*SendResponse); response {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || len(fields) != 5 {
			return ErrInvalid
		}
		for _, key := range []string{"protocol", "request_id", "status", "code", "delivery_uncertain"} {
			if _, present := fields[key]; !present {
				return ErrInvalid
			}
		}
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(destination) != nil {
		return ErrInvalid
	}
	return nil
}

func scanValue(decoder *json.Decoder, depth int) error {
	if depth > 8 {
		return ErrInvalid
	}
	token, err := decoder.Token()
	if err != nil || token == nil {
		return ErrInvalid
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		keys := map[string]bool{}
		for decoder.More() {
			token, err := decoder.Token()
			key, ok := token.(string)
			if err != nil || !ok || len(key) == 0 || len(key) > 64 || keys[key] || len(keys) >= 64 {
				return ErrInvalid
			}
			for _, c := range key {
				if !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '_' {
					return ErrInvalid
				}
			}
			keys[key] = true
			if scanValue(decoder, depth+1) != nil {
				return ErrInvalid
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim('}') {
			return ErrInvalid
		}
	case '[':
		count := 0
		for decoder.More() {
			count++
			if count > 64 || scanValue(decoder, depth+1) != nil {
				return ErrInvalid
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(']') {
			return ErrInvalid
		}
	default:
		return ErrInvalid
	}
	return nil
}
