"use client";

import * as React from "react";
import { Badge, Icon } from "@/ds/components";

/**
 * EXCEL TEMPLATES — download and upload (ux/15, PLACEHOLDER).
 *
 * Akshay, 9 Oct: vendors download a template per product × variant, fill it
 * in Excel and upload it back. From Products to bid they can download many
 * at once: one file per quotation template, holding every selected product ×
 * variant that uses it. The UI is here so the flow can be reviewed; the
 * file generation and parsing are engineering's (PRD section 8).
 */

export type TemplateItem = {
  styleNumber: string;
  name: string;
  templateName: string;
  /** Rows the file will hold for this product: its variants, or 1 if whole. */
  rows: number;
};

/** One file per template — the rule the dialog states before anything is built. */
export function filesFor(items: TemplateItem[]) {
  const by = new Map<string, { products: number; rows: number }>();
  for (const it of items) {
    const f = by.get(it.templateName) ?? { products: 0, rows: 0 };
    f.products += 1;
    f.rows += Math.max(1, it.rows);
    by.set(it.templateName, f);
  }
  return [...by.entries()].map(([templateName, f]) => ({ templateName, ...f }));
}

function Shell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="scrim app-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tf-title">
        <div className="modal-h">
          <div className="ttl" id="tf-title">
            {title} <Badge>Coming soon</Badge>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        <div className="modal-f">{footer}</div>
      </div>
    </div>
  );
}

export function TemplateDownloadDialog({
  items,
  onClose,
}: {
  items: TemplateItem[];
  onClose: () => void;
}) {
  const files = filesFor(items);
  return (
    <Shell
      title={files.length > 1 ? `Download ${files.length} templates` : "Download template"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled title="Template export is being built">
            <Icon name="download" size="sm" />
            Download {files.length === 1 ? "file" : `${files.length} files`}
          </button>
        </>
      }
    >
      <p className="tf-lede">
        One Excel file per quotation template. Each holds a row for every product × variant you picked
        that uses it. Fill in your costs, then use <strong>Upload quotation</strong>.
      </p>
      <ul className="tf-files">
        {files.map((f) => (
          <li key={f.templateName}>
            <Icon name="invoice" size="sm" />
            <span className="tf-name">{f.templateName}.xlsx</span>
            <span className="tf-meta">
              {f.products} product{f.products === 1 ? "" : "s"} · {f.rows} row{f.rows === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export function TemplateUploadDialog({ onClose }: { onClose: () => void }) {
  return (
    <Shell
      title="Upload quotation"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled title="Template import is being built">
            Apply to draft
          </button>
        </>
      }
    >
      <div className="tf-drop" aria-disabled="true">
        <Icon name="upload" size="lg" />
        <strong>Drop a filled template here</strong>
        <span>.xlsx, downloaded from Procura</span>
      </div>
      <ol className="tf-steps">
        <li>We match each row to its product and variant by the key column.</li>
        <li>You see what will change, and any rows we could not read.</li>
        <li>Apply puts the numbers into your draft. Nothing is sent to Quince until you Submit.</li>
      </ol>
    </Shell>
  );
}

/** "Excel ▾" on a bid page: download this product's template, or upload one. */
export function ExcelMenu({
  onDownload,
  onUpload,
  canUpload,
}: {
  onDownload: () => void;
  onUpload: () => void;
  canUpload: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="bm-wrap" ref={wrap}>
      <button
        type="button"
        className="btn btn--secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Excel
        <Icon name="chevron_down" size="sm" />
      </button>
      {open ? (
        <div className="bm-menu" role="menu">
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onDownload(); }}>
            Download template
          </button>
          {canUpload ? (
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onUpload(); }}>
              Upload quotation
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
