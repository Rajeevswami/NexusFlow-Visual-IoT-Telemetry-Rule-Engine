import { ChevronRight, Download, FolderOpen, LoaderCircle, Play, Save, Send, ShieldCheck, Square } from 'lucide-react';
import NavLinks from './NavLinks.jsx';

/**
 * Top toolbar: health indicator, Editor | Dashboard nav, activation controls
 * (Activate / Deactivate / Send Test Data + live status badge) and
 * Load / Validate / Export / Save.
 *
 * The activation props are optional so pages that do not manage a pipeline can omit them.
 */
export default function Navbar({
  health,
  onSave,
  onLoad,
  onValidate,
  onExport,
  saving,
  validating,
  activation,
  onActivate,
  onDeactivate,
  onSendTestData,
  activating = false,
  testing = false,
}) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  const status = activation?.status ?? 'inactive';
  const statusLabel = status === 'active' ? 'ACTIVE' : status === 'error' ? 'ERROR' : 'INACTIVE';

  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <NavLinks />
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />

        {onActivate && (
          <>
            <span className={`engine-badge engine-badge-${status}`} title={activation?.message ?? 'Pipeline status'}>
              <i />{statusLabel}
            </span>
            <button className="button button-ghost" onClick={onActivate} disabled={activating || status === 'active'}>
              {activating ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              <span>{activating ? 'Activating…' : 'Activate'}</span>
            </button>
            <button className="button button-ghost" onClick={onDeactivate} disabled={status !== 'active'}>
              <Square size={16} /><span>Deactivate</span>
            </button>
            <button className="button button-ghost" onClick={onSendTestData} disabled={testing}>
              {testing ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              <span>{testing ? 'Sending…' : 'Send test data'}</span>
            </button>
            <div className="nav-divider" />
          </>
        )}

        <button className="button button-ghost" onClick={onLoad}><FolderOpen size={16} /><span>Load graph</span></button>
        <button className="button button-ghost" onClick={onValidate} disabled={validating}>
          {validating ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
          <span>{validating ? 'Validating...' : 'Validate graph'}</span>
        </button>
        <button className="button button-ghost" onClick={onExport}><Download size={16} /><span>Export JSON</span></button>
        <button className="button button-primary" onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}<span>{saving ? 'Saving...' : 'Save graph'}</span>
        </button>
      </div>
    </header>
  );
}
