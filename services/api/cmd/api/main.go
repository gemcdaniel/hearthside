// Command api runs the Hearthside backend service.
package main

import (
	"fmt"

	"github.com/gemcdaniel/hearthside/services/api/internal/health"
)

func main() {
	status := health.Check()
	fmt.Printf("hearthside-api status=%s engine=%s\n", status.Status, status.EngineVersion)
}
