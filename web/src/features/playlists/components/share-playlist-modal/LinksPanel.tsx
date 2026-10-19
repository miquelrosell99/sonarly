import { Button } from '../../../../components/ui/button.js';
import { Checkbox } from '../../../../components/ui/checkbox.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { Input } from '../../../../components/ui/input.js';
import { PageState } from '../../../../components/PageState.js';

export interface LinksPanelProps {
  shareUrl: string | null;
  shareDownload: boolean | undefined;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onToggleDownload: (next: boolean) => void;
  onGenerate: () => void;
  onRevoke: () => void;
}

export function LinksPanel({
  shareUrl,
  shareDownload,
  busy,
  copied,
  onCopy,
  onToggleDownload,
  onGenerate,
  onRevoke,
}: LinksPanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-on-surface-variant">
        Anyone with the link can view this playlist, even without an account.
      </p>
      {shareUrl ? (
        <>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shareUrl}
              aria-label="Share link"
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button variant="ghost" onClick={onCopy} className="min-h-[44px] shrink-0">
              <Icon name={copied ? 'mdi-check' : 'mdi-content-copy'} size={16} className="mr-1.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="rounded-item border border-outline bg-surface px-3 py-1">
            <Checkbox
              id="share-playlist-allow-download"
              label="Allow download"
              description="Anyone with the link can download the playlist's tracks (ZIP packs and single files)."
              checked={shareDownload === true}
              disabled={busy}
              onCheckedChange={(checked) => void onToggleDownload(checked)}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onGenerate} disabled={busy} className="min-h-[44px]">
              <Icon name="mdi-refresh" size={16} className="mr-1.5" />
              Regenerate
            </Button>
            <Button variant="danger" onClick={onRevoke} disabled={busy} className="min-h-[44px]">
              <Icon name="mdi-link-variant-off" size={16} className="mr-1.5" />
              Revoke
            </Button>
          </div>
        </>
      ) : (
        <>
          <PageState isEmpty emptyMessage="No share link yet." emptyIcon="mdi-link-variant-off">
            {null}
          </PageState>
          <Button onClick={onGenerate} disabled={busy} className="min-h-[44px] w-full">
            <Icon name="mdi-link-variant" size={16} className="mr-1.5" />
            Generate link
          </Button>
        </>
      )}
    </div>
  );
}
