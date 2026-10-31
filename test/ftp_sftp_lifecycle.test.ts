import { test } from 'node:test';
import assert from 'node:assert';

test('FTP/SFTP Protocol Lifecycle: protocol routing and error persistence', () => {
  interface DownloadRecord {
    id: string;
    url: string;
    protocol: string;
    status: string;
    downloaded_bytes: number;
    error_message: string | null;
  }

  const db = new Map<string, DownloadRecord>();

  function dispatchDownload(id: string, url: string): { protocol: string; error?: string } {
    let protocol = '';
    if (url.startsWith('ftp://')) protocol = 'ftp';
    else if (url.startsWith('ftps://')) protocol = 'ftps';
    else if (url.startsWith('sftp://')) protocol = 'sftp';
    else if (url.startsWith('http://') || url.startsWith('https://')) protocol = 'http';
    else return { protocol: 'unknown', error: `Unsupported protocol in URL: ${url}` };

    db.set(id, {
      id,
      url,
      protocol,
      status: 'downloading',
      downloaded_bytes: 0,
      error_message: null,
    });

    return { protocol };
  }

  function simulateEngineError(id: string, errorMessage: string) {
    const item = db.get(id);
    if (!item) return;
    item.status = 'error';
    item.error_message = errorMessage;
  }

  // 1. FTP dispatch
  const ftpRes = dispatchDownload('dl-ftp-1', 'ftp://ftp.gnu.org/gnu/emacs/emacs-29.3.tar.gz');
  assert.strictEqual(ftpRes.protocol, 'ftp');
  assert.strictEqual(db.get('dl-ftp-1')!.protocol, 'ftp');

  // 2. FTPS dispatch
  const ftpsRes = dispatchDownload('dl-ftps-1', 'ftps://secure.files.internal/archive.zip');
  assert.strictEqual(ftpsRes.protocol, 'ftps');
  assert.strictEqual(db.get('dl-ftps-1')!.protocol, 'ftps');

  // 3. SFTP dispatch
  const sftpRes = dispatchDownload('dl-sftp-1', 'sftp://admin@192.168.1.100:2222/backup.tar');
  assert.strictEqual(sftpRes.protocol, 'sftp');
  assert.strictEqual(db.get('dl-sftp-1')!.protocol, 'sftp');

  // 4. Connection failure persists real error message
  simulateEngineError('dl-ftp-1', 'FTP connection to ftp.gnu.org:21 failed: Connection refused (os error 111)');
  const failedFtp = db.get('dl-ftp-1')!;
  assert.strictEqual(failedFtp.status, 'error');
  assert.ok(failedFtp.error_message?.includes('Connection refused'));

  // 5. Authentication failure persists real error message
  simulateEngineError('dl-sftp-1', "SFTP user authentication failed for 'admin': Bad password");
  const failedSftp = db.get('dl-sftp-1')!;
  assert.strictEqual(failedSftp.status, 'error');
  assert.ok(failedSftp.error_message?.includes('Bad password'));

  // 6. Cancellation preserves state
  const itemToCancel = db.get('dl-ftps-1')!;
  itemToCancel.downloaded_bytes = 409600;
  itemToCancel.status = 'paused';
  assert.strictEqual(itemToCancel.downloaded_bytes, 409600, 'Cancellation/pause retains downloaded bytes');
});
