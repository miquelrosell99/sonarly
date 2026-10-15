import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { BrandMark } from '../../../components/BrandMark.js';

const REPO_URL = 'https://github.com/miquelrosell99/sonarly';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

export function SettingsAbout() {
  const year = new Date().getFullYear();
  return (
    <Settings>
      <SettingsCard icon="mdi-information-outline" title="About">
        <div className="flex items-center gap-4">
          <BrandMark className="h-12 w-12 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold">Sonarly</p>
            <p className="text-sm text-muted">Self-hosted music streaming for your own library.</p>
          </div>
        </div>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-secondary">Source</dt>
            <dd>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-fg-primary">
                github.com/miquelrosell99/sonarly
              </a>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-secondary">License</dt>
            <dd>
              <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="text-fg-primary">
                GNU AGPL v3.0
              </a>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-secondary">Copyright</dt>
            <dd className="text-fg-primary">© {year} Miquel Rosell Tarragó</dd>
          </div>
        </dl>
      </SettingsCard>
    </Settings>
  );
}
