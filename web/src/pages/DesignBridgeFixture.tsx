import * as React from 'react';
import { Button } from '../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';

// Design-bridge fixture (rosellramos-design-system components/shadcn-bridge.md
// "CI fixture"): mounts the NORMALIZED catalog components with data-fix hooks
// so the Playwright spec (e2e/bridge-fixture.spec.ts) can assert computed
// behavior — token resolution, contrast, interaction states, the accent seam
// — across themes WITHOUT credentials or any app data. The route is wired
// before the boot/auth gates in App.tsx on purpose: it must render even when
// the API is unreachable.
export default function DesignBridgeFixture() {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <main className="min-h-screen bg-background p-8 text-on-surface">
      <h1 className="mb-6 font-display text-xl font-semibold">Design bridge fixture</h1>
      <div className="flex flex-wrap items-center gap-4">
        <Button data-fix="btn-primary" variant="primary">
          Save
        </Button>
        <Button data-fix="btn-outline" variant="outline">
          Cancel
        </Button>
        <Button data-fix="btn-disabled" disabled>
          Disabled
        </Button>
        <Button data-fix="btn-loading" loading>
          Saving…
        </Button>
        <Button data-fix="dialog-open" variant="ghost" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-fix="dialog">
          <DialogHeader>
            <DialogTitle>Fixture dialog</DialogTitle>
            <DialogDescription>
              Elevation and scrim register probe for the bridge spec.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-on-surface-variant">Dialog body.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
