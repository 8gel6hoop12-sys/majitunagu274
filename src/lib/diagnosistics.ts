// src/lib/diagnostics.ts
export type StepResult = { step: string; ok: boolean; detail?: any; error?: string };

export async function runWriteDiagnostics(writeBase: string, sample: Record<string,string>) {
  const results: StepResult[] = [];
  const ok = (step:string, detail?:any) => results.push({ step, ok:true, detail });
  const ng = (step:string, err:any) => results.push({ step, ok:false, error:String(err?.message||err) });

  const qs = new URLSearchParams(sample).toString();
  const debugUrl = `${writeBase}?debug=1&${qs}`;

  // 1) 画像ピン
  try {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = `${writeBase}?ping=image&ts=${Date.now()}`;
      setTimeout(resolve, 800);
    });
    ok('image-ping');
  } catch(e){ ng('image-ping', e); }

  // 2) fetch GET no-cors
  try {
    await fetch(`${writeBase}?ping=get-nocors&ts=${Date.now()}`, { method:'GET', mode:'no-cors' });
    ok('fetch-get-nocors');
  } catch(e){ ng('fetch-get-nocors', e); }

  // 3) fetch POST no-cors
  try {
    await fetch(writeBase, {
      method:'POST', mode:'no-cors',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
      body: qs,
    });
    ok('fetch-post-nocors');
  } catch(e){ ng('fetch-post-nocors', e); }

  // 4) sendBeacon
  try {
    if ('sendBeacon' in navigator) {
      const blob = new Blob([qs], { type:'application/x-www-form-urlencoded;charset=UTF-8' });
      const sent = (navigator as any).sendBeacon(writeBase, blob);
      ok('sendBeacon', {returned: sent});
    } else {
      ok('sendBeacon', {returned:'not-supported'});
    }
  } catch(e){ ng('sendBeacon', e); }

  // 5) CORS デバッグ GET（JSON）
  try {
    const res = await fetch(debugUrl, { method:'GET', mode:'cors' });
    const json = await res.json();
    ok('debug-echo-get', json);
  } catch(e){ ng('debug-echo-get', e); }

  // 6) 実 upsert
  try {
    const writeQs = new URLSearchParams({
      type:'profiles',
      ...sample,
      createdAt: sample.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).toString();

    const res = await fetch(`${writeBase}?${writeQs}`, { method:'GET', mode:'cors' });
    let json:any=null; try { json = await res.json(); } catch {}
    ok('profiles-write-get-cors', { status: res.status, json });

    await fetch(writeBase, {
      method:'POST', mode:'no-cors',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
      body: writeQs,
    });
    ok('profiles-write-post-nocors');
  } catch(e){ ng('profiles-write', e); }

  // 画面にも出す
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;bottom:8px;right:8px;max-width:48vw;max-height:48vh;overflow:auto;background:#111;color:#0f0;padding:12px;font-size:12px;z-index:99999;border-radius:8px';
  pre.textContent = JSON.stringify(results, null, 2);
  document.body.appendChild(pre);

  console.table(results);
  return results;
}
