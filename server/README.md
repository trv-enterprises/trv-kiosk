# Voice Display Server

## Backend Decision

The voice display uses the **existing dashboard server** rather than a separate backend:

- **Dashboard Server**: Points to your dashboard server running on port 3001
- **Database**: Shared with main dashboard
- **Redis**: Same instance, same DB

### Why Not a Separate Server?

1. **Shared Content**: Dashboards and charts created in the main dashboard UI are the same ones displayed on the voice display
2. **Simpler Deployment**: No need to manage two Go server instances
3. **Reduced Maintenance**: One codebase to update
4. **Same Data**: No data sync issues between systems

### If You Need a Separate Server

If you later need isolation (different dashboards, different data), you can:

1. Deploy a second instance of dashboard server-go
2. Configure it with a different MongoDB database (e.g., `voice_display`)
3. Point the display app to the new server URL via `VITE_API_URL`

The config file in `config/config.yaml` shows the settings that would be needed.

### Server Config Reference

See `config/config.yaml` for the configuration that would be used if running a separate server instance.
