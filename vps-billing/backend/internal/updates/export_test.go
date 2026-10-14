package updates

import "net/http"

// This factory is compiled only into the test variant of the package. The
// production core has no transport, URL, or environment override for updates.
func NewForTransportTest(token string, current func() Current, transport http.RoundTripper) *Service {
	service := New(token, current)
	service.client.http.Transport = transport
	return service
}
