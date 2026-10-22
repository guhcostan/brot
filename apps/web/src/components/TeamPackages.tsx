import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Team } from '@brot/protocol';
import { Button, Textarea } from '@brot/ui';
import type { TeamPackageImportCounts } from '../data/client';
import { downloadTextFile, readFileText } from '../download';
import { t } from '../i18n';
import { packageIssueText, previewTeamPackage } from '../teamPackagePreview';
import { useClient } from './client';
import { ConfirmDialog } from './Dialog';
import { Download, FileDoc } from './icons';

export interface TeamPackagesProps {
  /** Teams for the export scope before the client load resolves, e.g. in an SSR render. */
  initialTeams?: Team[];
  /** Package content to preview before a person pastes one, e.g. in an SSR render. */
  initialContent?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "2 teams · 5 bots · 1 room · …" from the counts, in the app's language. */
function countsText(counts: TeamPackageImportCounts): string {
  return t('settings.teamPackageCounts', {
    teams: String(counts.teams),
    bots: String(counts.bots),
    rooms: String(counts.rooms),
    routines: String(counts.routines),
    skills: String(counts.skills),
  });
}

/**
 * Share a team as one Markdown package: download the current team (or the workspace), or paste and import
 * one. The package is parsed client-side for the preview, so a bad file never reaches the server.
 */
export function TeamPackages({ initialTeams, initialContent }: TeamPackagesProps): ReactElement {
  const client = useClient();
  const [teams, setTeams] = useState<Team[] | null>(initialTeams ?? null);
  const [scope, setScope] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [content, setContent] = useState(initialContent ?? '');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<TeamPackageImportCounts | null>(null);
  const [confirming, setConfirming] = useState(false);

  const scopeId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTeams = useCallback(async () => {
    try {
      setTeams(await client.listTeams());
    } catch (error) {
      // The export still works for the whole workspace; leave the scope list empty and keep the rest usable.
      console.warn('Teams did not load', error);
      setTeams((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const preview = useMemo(() => (content.trim() === '' ? null : previewTeamPackage(content)), [content]);

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const exported = await client.exportTeamPackage(scope === '' ? undefined : scope);
      if (!downloadTextFile(exported.filename, exported.content)) setDownloadError(t('settings.teamPackageDownloadUnavailable'));
    } catch (error) {
      setDownloadError(messageOf(error));
    } finally {
      setDownloading(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setFileError(null);
    setImportError(null);
    setImported(null);
    try {
      setContent(await readFileText(file));
      setFileName(file.name);
    } catch (error) {
      setFileError(t('settings.teamPackageFileError', { message: messageOf(error) }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-sm font-semibold">{t('settings.teamPackageExport')}</h3>
        <p className="m-0 text-sm text-ink-2">{t('settings.teamPackageExportBody')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={scopeId} className="text-sm font-medium">
              {t('settings.teamPackageScope')}
            </label>
            <select id={scopeId} value={scope} onChange={(event) => setScope(event.target.value)} disabled={teams === null} className="brot-input">
              <option value="">{t('settings.teamPackageScopeAll')}</option>
              {(teams ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => void download()} disabled={downloading}>
            <Download size={15} />
            {downloading ? t('settings.teamPackageDownloading') : t('settings.teamPackageDownload')}
          </Button>
        </div>
        {downloadError ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {downloadError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="m-0 text-sm font-semibold">{t('settings.teamPackageImport')}</h3>
        <p className="m-0 text-sm text-ink-2">{t('settings.teamPackageImportBody')}</p>
        <Textarea
          label={t('settings.teamPackagePaste')}
          hideLabel
          placeholder={t('settings.teamPackagePastePlaceholder')}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setFileName(null);
            setFileError(null);
            setImportError(null);
            setImported(null);
          }}
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.json,text/markdown,application/json"
            className="hidden"
            onChange={(event) => {
              void pickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="text-ink-2">
            <FileDoc size={14} />
            {t('settings.teamPackageChooseFile')}
          </Button>
          {fileName !== null ? <span className="text-xs text-ink-3">{fileName}</span> : null}
        </div>
        {fileError ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {fileError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <h4 className="m-0 text-xs font-semibold text-ink-2">{t('settings.teamPackagePreview')}</h4>
          {preview === null ? (
            <p className="m-0 text-sm text-ink-3">{t('settings.teamPackagePreviewEmpty')}</p>
          ) : preview.ok ? (
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-sm font-medium">{countsText(preview.preview.counts)}</p>
              <PreviewNames label={t('settings.teamPackageTeams')} names={preview.preview.teams} />
              <PreviewNames label={t('settings.teamPackageBots')} names={preview.preview.bots} />
              <PreviewNames label={t('settings.teamPackageRooms')} names={preview.preview.rooms} />
              <PreviewNames label={t('settings.teamPackageRoutines')} names={preview.preview.routines} />
              <PreviewNames label={t('settings.teamPackageSkills')} names={preview.preview.skills} />
            </div>
          ) : (
            <div role="alert" className="flex flex-col gap-1 text-sm text-attention-text">
              <span className="font-medium">{t('settings.teamPackagePreviewInvalid')}</span>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
                {preview.issues.map((issue, index) => (
                  <li key={index}>{packageIssueText(issue)}</li>
                ))}
              </ul>
            </div>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-ink-2">
            <li>{t('settings.teamPackageWarningBots')}</li>
            <li>{t('settings.teamPackageWarningRoutines')}</li>
          </ul>
        </div>

        {importError ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {importError}
          </p>
        ) : null}
        {imported !== null ? (
          <p role="status" className="m-0 text-sm text-ink">
            {t('settings.teamPackageImported', { counts: countsText(imported) })}
          </p>
        ) : null}
        <div>
          <Button variant="primary" onClick={() => setConfirming(true)} disabled={preview === null || !preview.ok}>
            {t('settings.teamPackageImportAction')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('settings.teamPackageConfirmTitle')}
        description={preview?.ok ? t('settings.teamPackageConfirmBody', { counts: countsText(preview.preview.counts) }) : ''}
        confirmLabel={t('settings.teamPackageImportAction')}
        onConfirm={async () => {
          if (preview === null || !preview.ok) return;
          try {
            const counts = await client.importTeamPackage(content);
            setImported(counts);
            setContent('');
            setFileName(null);
            setImportError(null);
            await loadTeams();
          } catch (error) {
            setImportError(messageOf(error));
          }
        }}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function PreviewNames({ label, names }: { label: string; names: readonly string[] }): ReactElement | null {
  if (names.length === 0) return null;
  return (
    <p className="m-0 truncate text-xs text-ink-2">
      <span className="font-medium text-ink">{label}</span> {names.join(', ')}
    </p>
  );
}
