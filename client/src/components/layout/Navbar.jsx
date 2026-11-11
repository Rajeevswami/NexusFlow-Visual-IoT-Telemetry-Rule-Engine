import { ChevronRight, Download, FolderOpen, LoaderCircle, Save, ShieldCheck } from 'lucide-react';

/**
 * Top toolbar: health indicator, Load / Validate / Export / Save.
 */
export default function Navbar({ health, onSave, onLoad, onValidate, onExport, saving, validating }) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />
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
