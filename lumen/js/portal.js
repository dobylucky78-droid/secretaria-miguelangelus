'use strict';
/* (Secretaria — protótipo, 24/11/2026) 🌐 Portal das pastorais, aba das 📋 Escalas.
 *
 * O portal é um Google Apps Script na conta da paróquia (pasta portal/ do projeto). As pastorais entram com login e senha
 * do portal e escrevem a escala da função que a secretaria deu a elas; os dados ficam no Drive da paróquia.
 * A Secretaria NÃO lê o Drive do portal (o escopo drive.file só enxerga os arquivos dela): conversa com o portal pela
 * internet, com a chave da secretaria. A Secretaria cria o portal sozinha (🌐 Criar o portal: Apps Script API pelo
 * programa, app\GooglePortal.cs) e põe no código só o resumo da chave (CHAVE_HASH).
 *
 * Registro (store 'esc', pasta "secretaria/" da nuvem, só entre as Secretarias): secv-portal { url, chave, scriptId, deploymentId }
 *
 * O que vai ao portal (📤): as Missas do mês (dia, hora, igreja), as funções, o que está na escala de cada Missa,
 * as equipes (nome e membros) e os nomes de cada função. Nunca telefone, observação ou "avulso".
 * Funções de menores (coroinhas, acólitos): os nomes vão com o 1º nome e a inicial ("Ana S."); na volta, viram o nome
 * completo de novo quando só uma pessoa da função combina.
 * O que volta (📥): só o que as pastorais mudaram; a secretaria confere numa prévia e aplica (ou descarta).
 */

const Portal = { usuarios: null, previa: null, situacao: '', mes: '' };

const ehMenores = f => !!f && (/^(coroinhas|acolitos)$/.test(f.id) || /coroinha|ac[oó]lit/i.test(f.nome || ''));
const nomeCurtoPortal = n => { const p = String(n).trim().split(/\s+/); return p.length < 2 ? p[0] : `${p[0]} ${p.at(-1)[0].toUpperCase()}.`; };
const ehEquipe = n => !!equipePorNome(n);
// nomes de uma cela para o portal (menores: curto)
const celaParaPortal = (txt, f) => !ehMenores(f) ? String(txt || '') : nomesDe(txt).map(n => ehEquipe(n) ? n : nomeCurtoPortal(n)).join(', ');
// nomes que voltam do portal (menores: o nome completo, se só uma pessoa da função combina)
function celaDoPortal(txt, f) {
  const t = String(txt || '').trim();
  if (!t) return '—';
  if (!ehMenores(f)) return t;
  return nomesDe(t).map(n => {
    if (ehEquipe(n)) return n;
    const ps = [...new Set(Esc.pessoas.filter(p => p.funcoes?.includes(f.id) && (p.nome === n || nomeCurtoPortal(p.nome) === n)).map(p => p.nome))];
    return ps.length === 1 ? ps[0] : n;
  }).join(', ') || t;
}

async function chamarPortal(acao, dados = {}) {
  const c = Esc.portal;
  if (!c?.url || !c?.chave) throw new Error('Preencha o endereço e a chave do portal.');
  let r;
  try { r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ acao, chave: c.chave, ...dados }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' }); }
  catch (_) { throw new Error('Sem conexão com o portal (internet? endereço certo?).'); }
  if (!r.ok) throw new Error(`O portal respondeu ${r.status}.`);
  let j;
  try { j = await r.json(); } catch (_) {
    const e = new Error('O portal ainda não foi autorizado: clique em ↗ Abrir o portal, entre com a conta da paróquia e clique em Permitir.');
    e.semAutorizar = true; throw e;
  }
  if (!j.ok && /googleapis\.com\/auth\//.test(j.erro || '')) {          // código novo pedindo uma permissão que o dono ainda não deu
    const e = new Error('O código novo do portal precisa de uma permissão a mais.');
    e.semAutorizar = e.reautorizar = true; throw e;
  }
  if (!j.ok) throw new Error(j.erro || 'O portal recusou.');
  return j;
}

// ---------------------------------------------------------------- pacote do mês
function pacotePortal(mes) {
  const fs = funcoesEsc(), ocs = missasDoMes(mes, '');
  const missas = ocs.map(o => ({ chave: o.chave, iso: o.iso, hora: o.hora, texto: o.texto }));    // "Missa Matriz SJO"
  const base = {}, equipes = {}, pessoas = {};
  for (const o of ocs) for (const f of fs) { const v = valorCela(o, f); if (v) base[chaveCela(o, f.id)] = celaParaPortal(v, f); }
  for (const f of fs) {
    equipes[f.id] = Esc.equipes.filter(e => e.funcao === f.id).map(e => ({ nome: e.nome, membros: nomesDe(e.membros).map(n => ehMenores(f) ? nomeCurtoPortal(n) : n).join(', ') }));
    pessoas[f.id] = [...new Set(Esc.pessoas.filter(p => p.funcoes?.includes(f.id)).map(p => ehMenores(f) ? nomeCurtoPortal(p.nome) : p.nome))];
  }
  return { mes, funcoes: fs.map(f => ({ id: f.id, nome: f.nome, vagas: +f.vagas || 1, menores: ehMenores(f) })), missas, base, equipes, pessoas };
}

// ---------------------------------------------------------------- 🌐 criar o portal (a Secretaria faz tudo)
// O código do portal vai dentro do programa (web/portal). A Secretaria cria o projeto do Apps Script na conta da paróquia
// (app\GooglePortal.cs, ações portalStatus/portalConectar/portalApi), põe o código, publica como app da Web e gera a chave.
// A secretária só escolhe a conta, clica em Permitir e, no fim, abre o portal uma vez para o Google autorizar o Drive.
const ptApi = (metodo, caminho, corpo) => arqApp('portalApi', { metodo, caminho, corpo: corpo || null }, 120000).then(r => r.dados);

const HTML_PORTAL = `
  <p class="sutil pequeno" style="margin:0 0 6px">🌐 Página na internet onde cada pastoral escreve a própria escala, com login e senha do portal.
    Os dados ficam no <b>Google Drive da paróquia</b>; a secretaria aprova quem entra, escolhe o que cada um pode mudar e confere tudo antes de pôr na escala.</p>
  <div id="ptCriar" class="esc-pt-criar" hidden>
    <button type="button" id="ptCriarBt" class="primario">🌐 Criar o portal da paróquia</button>
    <p class="sutil pequeno">A Secretaria cria o portal sozinha na <b>conta Google da paróquia</b> (a mesma da ☁ nuvem). Se a nuvem não estiver ligada,
      ela pede o <b>arquivo do Google (JSON)</b> baixado no Google Cloud. O Google vai pedir para escolher a conta e <b>Permitir</b>; no fim,
      o portal abre uma vez para você clicar em <b>Permitir</b> de novo. De graça, uns 2 minutos.</p>
    <ol id="ptPassos" class="esc-pt-passos" hidden></ol>
  </div>
  <div id="ptPronto" class="linha" hidden>
    <span id="ptLink" class="pequeno"></span><span class="espaco"></span>
    <button type="button" id="ptCopiar" title="Para mandar às coordenações das pastorais">📋 Copiar o link do portal</button>
    <button type="button" id="ptAbrir">↗ Abrir o portal</button>
    <button type="button" id="ptAtualizarCod" hidden title="Põe o código novo do portal (o link e os dados continuam os mesmos)">⬆ Atualizar o portal</button>
  </div>
  <p id="ptSituacao" class="pequeno"></p>
  <div id="ptCorpo" hidden>
    <h3 class="esc-pt-tit">🙋 Pedidos de acesso <button type="button" id="ptAtualizar" class="pequeno">↻ Atualizar</button></h3>
    <div id="ptPedidos"></div>
    <h3 class="esc-pt-tit">🔑 Quem tem acesso</h3>
    <div id="ptUsuarios"></div>
    <h3 class="esc-pt-tit">📅 Escala do mês no portal</h3>
    <div class="linha">
      <label class="campo">Mês <input type="month" id="ptMes"></label>
      <button type="button" id="ptEnviar" title="Manda as Missas do mês, o que já está na escala, as equipes e os nomes de cada função">📤 Mandar o mês ao portal</button>
      <button type="button" id="ptTrazer" class="primario">📥 Ver o que as pastorais mudaram</button>
    </div>
    <div id="ptPrevia"></div>
  </div>
  <details class="esc-pt-avancado"><summary class="pequeno sutil">Avançado: endereço e chave do portal</summary>
    <p class="sutil pequeno">Só para quem já tem um portal criado de outro jeito (ou para trocar de portal). Normalmente a Secretaria preenche sozinha.</p>
    <div class="linha">
      <label class="campo" style="flex:2">Endereço do portal <input id="ptUrl" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false"></label>
      <label class="campo">Chave da secretaria <input id="ptChave" type="password" placeholder="MA-XXXX-XXXX-…" spellcheck="false"></label>
      <button type="button" id="ptSalvar">Salvar e testar</button>
    </div>
    <p class="sutil pequeno">Código do portal, para montar à mão no Apps Script:
      <button type="button" data-pt-copiar="Codigo.gs">📋 Código.gs</button> <button type="button" data-pt-copiar="Portal.html">📋 Portal (HTML)</button>
      <button type="button" data-pt-copiar="appsscript.json">📋 appsscript.json</button></p>
  </details>`;

function renderPortalEsc() {
  const c = Esc.portal || {};
  if (document.activeElement?.id !== 'ptUrl') $('#ptUrl').value = c.url || '';
  if (document.activeElement?.id !== 'ptChave') $('#ptChave').value = c.chave || '';
  $('#ptMes').value = Portal.mes || Esc.mes;
  $('#ptCriar').hidden = !!(c.url && c.chave);
  $('#ptPronto').hidden = !(c.url && c.chave);
  $('#ptLink').textContent = c.url ? '🔗 ' + c.url.replace(/^https:\/\//, '').slice(0, 60) + '…' : '';
  $('#ptAtualizarCod').hidden = !(c.scriptId && Portal.versaoNova && Portal.versao && cmpVersao(Portal.versaoNova, Portal.versao) > 0);
  $('#ptPassos').hidden = !Portal.passos;
  if (Portal.passos) $('#ptPassos').innerHTML = Portal.passos.map(p => `<li class="${p.ok ? 'ok' : p.erro ? 'erro' : p.ag ? 'ag' : ''}">${p.ok ? '✔' : p.erro ? '⚠' : p.ag ? '⏳' : '·'} ${p.txt}</li>`).join('');
  $('#ptCriarBt').disabled = !!Portal.criando;
  $('#ptSituacao').innerHTML = Portal.situacao || '';
  $('#ptCorpo').hidden = !Portal.usuarios || !c.url;
  if (Portal.usuarios) renderUsuariosPortal();
  renderPreviaPortal();
}

const quandoBR = iso => { try { const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso || ''; } };
const chkFuncoesPortal = (marcadas, pedida = '') => `<span class="esc-pt-funcs">${funcoesEsc().map(f => {
  const sim = marcadas.includes(f.id) || (!marcadas.length && pedida && semAcento(pedida) === semAcento(f.nome));
  return `<label class="esc-chk"><input type="checkbox" data-pt-f="${esc(f.id)}"${sim ? ' checked' : ''}> ${esc(f.nome)}</label>`;
}).join('')}</span>`;

function renderUsuariosPortal() {
  const us = Portal.usuarios || [];
  const pend = us.filter(u => u.situacao === 'pendente'), outros = us.filter(u => u.situacao === 'ativo' || u.situacao === 'desativado');
  $('#ptPedidos').innerHTML = !pend.length ? '<p class="sutil pequeno">Nenhum pedido esperando.</p>'
    : `<table class="esc-tab"><thead><tr><th>Nome</th><th>E-mail</th><th>Pediu</th><th>Pode mudar a escala de</th><th></th></tr></thead><tbody>${pend.map(u => `
      <tr data-pt-id="${esc(u.id)}"><td><b>${esc(u.nome)}</b><br><small class="sutil">${esc(quandoBR(u.criado))}</small></td><td>${esc(u.email)}</td>
        <td>${esc(u.pedido?.funcao || '')}${u.pedido?.recado ? `<br><small class="sutil">“${esc(u.pedido.recado)}”</small>` : ''}</td>
        <td>${chkFuncoesPortal([], u.pedido?.funcao)}</td>
        <td class="esc-acoes"><button type="button" class="primario" data-pt="aprovar">✔ Aprovar</button><button type="button" class="perigo" data-pt="recusar">Recusar</button></td></tr>`).join('')}</tbody></table>`;
  $('#ptUsuarios').innerHTML = !outros.length ? '<p class="sutil pequeno">Ninguém ainda.</p>'
    : `<table class="esc-tab"><thead><tr><th>Nome</th><th>E-mail</th><th>Pode mudar a escala de</th><th>Último acesso</th><th></th></tr></thead><tbody>${outros.map(u => `
      <tr data-pt-id="${esc(u.id)}" class="${u.situacao === 'desativado' ? 'esc-pt-off' : ''}"><td><b>${esc(u.nome)}</b>${u.situacao === 'desativado' ? '<br><small class="sutil">⏸ desativado</small>' : ''}${u.trocarSenha ? '<br><small class="sutil">senha provisória</small>' : ''}</td><td>${esc(u.email)}</td>
        <td>${chkFuncoesPortal(u.funcoes)} <button type="button" data-pt="funcoes" class="pequeno">Salvar</button></td>
        <td>${u.ultimo ? esc(quandoBR(u.ultimo)) : '<span class="sutil">nunca</span>'}</td>
        <td class="esc-acoes"><button type="button" data-pt="zerarSenha" title="Cria uma senha provisória para a pessoa entrar e escolher outra">🔑 Senha provisória</button>
          ${u.situacao === 'ativo' ? '<button type="button" data-pt="desativar">⏸ Desativar</button>' : '<button type="button" data-pt="reativar">▶ Reativar</button>'}
          <button type="button" class="perigo" data-pt="apagar" title="Apaga o cadastro (LGPD)">✕</button></td></tr>`).join('')}</tbody></table>`;
}

function renderPreviaPortal() {
  const p = Portal.previa;
  if (!p) return $('#ptPrevia').innerHTML = '';
  const extras = Object.entries(p.extras || {}).flatMap(([fid, ns]) => {
    const f = funcoesEsc().find(x => x.id === fid);
    return f ? ns.filter(n => !Esc.pessoas.some(q => q.funcoes?.includes(fid) && (q.nome === n || nomeCurtoPortal(q.nome) === n))).map(n => `${n} <small class="sutil">(${esc(f.nome)})</small>`) : [];
  });
  $('#ptPrevia').innerHTML = (p.linhas.length
    ? `<p class="pequeno">Mudanças das pastorais em <b>${esc(p.nomeMes)}</b> que ainda não estão na escala (mandado ao portal em ${esc(quandoBR(p.enviado))}):</p>
      <table class="esc-tab"><thead><tr><th></th><th>Missa</th><th>Função</th><th>Na Secretaria</th><th>No portal</th><th>Quem mudou</th></tr></thead><tbody>${p.linhas.map((l, i) => `
        <tr><td><input type="checkbox" data-pt-l="${i}" checked></td><td>${esc(l.missa)}</td><td>${esc(l.funcao)}</td>
          <td class="sutil">${esc(l.aqui || '—')}</td><td><b>${esc(l.la)}</b></td><td><small>${esc(l.porNome)}<br>${esc(quandoBR(l.em))}</small></td></tr>`).join('')}</tbody></table>
      <div class="linha"><span class="espaco"></span>
        <button type="button" id="ptDescartar" title="As desmarcadas somem do portal (volta o que está na Secretaria)">✖ Descartar as desmarcadas</button>
        <button type="button" id="ptAplicar" class="primario">✔ Pôr as marcadas na escala</button></div>`
    : `<p class="sutil pequeno">Nada novo das pastorais em ${esc(p.nomeMes)}${p.enviado ? '' : ' (o mês ainda não foi mandado ao portal: use 📤)'}.</p>`)
    + (p.fora ? `<p class="sutil pequeno">${p.fora} mudança(s) de Missas que não estão mais na Agenda foram ignoradas.</p>` : '')
    + (extras.length ? `<p class="pequeno">🙋 Nomes que as pastorais acrescentaram e ainda não estão em 🙋 Pessoas: ${extras.join(', ')}</p>` : '');
}

// ---------------------------------------------------------------- ações
async function testarPortal() {
  Portal.situacao = '⏳ Falando com o portal…'; renderPortalEsc();
  try {
    const r = await chamarPortal('ping');
    await chamarPortal('configurar', { paroquia: Agenda.dados.paroquia?.nome || '', brasao: await brasaoParaPortal(), funcoes: funcoesEsc().map(f => ({ id: f.id, nome: f.nome })) });
    Portal.usuarios = (await chamarPortal('usuarios')).usuarios;
    Portal.versao = r.versao;
    if (Portal.versaoNova === undefined) await versaoDoCodigoPortal();
    situacaoPortal();
  } catch (e) {
    Portal.usuarios = null;
    Portal.situacao = '⚠ ' + esc(e.message) + (e.reautorizar ? htmlReautorizar() : e.semAutorizar ? ' Depois clique em <button type="button" id="ptJaPermiti" class="primario">✔ Já permiti</button>' : '');
  }
  renderPortalEsc();
}
// brasão da paróquia para o cabeçalho do portal: o mesmo da ⬇ planilha (canto superior esquerdo do telão), PNG pequeno
async function brasaoParaPortal() {
  try {
    const b = await brasaoParaPlanilha(64);           // 64 px de altura × 3 = nítido no celular
    if (!b) return '';
    let s = ''; for (let i = 0; i < b.png.length; i += 0x8000) s += String.fromCharCode(...b.png.subarray(i, i + 0x8000));
    const url = 'data:image/png;base64,' + btoa(s);
    return url.length > 300000 ? '' : url;
  } catch (_) { return ''; }
}
function situacaoPortal() {
  const us = Portal.usuarios || [], at = us.filter(u => u.situacao === 'ativo').length, pe = us.filter(u => u.situacao === 'pendente').length;
  Portal.situacao = `✅ Portal ${esc(Portal.versao || '')} respondendo: ${at} com acesso, ${pe ? `<b>${pe} pedido${pe === 1 ? '' : 's'} esperando</b>` : 'nenhum pedido esperando'}.`
    + (Portal.versaoNova && Portal.versao && cmpVersao(Portal.versaoNova, Portal.versao) > 0
      ? `<br>⬆ <b>Há código novo do portal (${esc(Portal.versaoNova)})</b>: ${Esc.portal?.scriptId ? 'clique em ⬆ Atualizar o portal' : 'copie o código novo em Avançado'} (o link e os dados continuam os mesmos).` : '');
}
const cmpVersao = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// o código do portal vai junto com a Secretaria (pasta portal/), para a paróquia copiar e colar no Apps Script
async function textoDoPortal(arq) {
  const r = await fetch('portal/' + arq, { cache: 'no-store' });
  if (!r.ok) throw new Error('arquivo do portal não encontrado: ' + arq);
  return r.text();
}
async function copiarArquivoPortal(arq, botao) {
  try {
    await navigator.clipboard.writeText(await textoDoPortal(arq));
    const t = botao.textContent; botao.textContent = '✔ Copiado: agora cole lá'; setTimeout(() => { botao.textContent = t; }, 4000);
  } catch (e) { toast('⚠ Não deu para copiar: ' + e.message); }
}
async function versaoDoCodigoPortal() {
  try { Portal.versaoNova = ((await textoDoPortal('Codigo.gs')).match(/VERSAO_PORTAL\s*=\s*'([\d.]+)'/) || [])[1] || ''; } catch (_) { Portal.versaoNova = ''; }
}

// ---------------------------------------------------------------- 🌐 criar / ⬆ atualizar (Apps Script API, pelo programa)
const novaChavePortal = () => 'MA-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-');
async function resumoChave(chave) {               // = resumo_() do Codigo.gs: SHA-256 do texto UTF-8, em base64
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave)));
  return btoa(String.fromCharCode(...d));
}
async function arquivosPortal(chave) {
  const [cod, html, man] = await Promise.all(['Codigo.gs', 'Portal.html', 'appsscript.json'].map(textoDoPortal));
  const h = await resumoChave(chave), cod2 = cod.replace(/const CHAVE_HASH = '[^']*';/, `const CHAVE_HASH = '${h}';`);
  if (cod2 === cod) throw new Error('o código do portal desta Secretaria está estranho (sem CHAVE_HASH)');
  return { versao: (cod.match(/VERSAO_PORTAL\s*=\s*'([\d.]+)'/) || [])[1] || '', files: [
    { name: 'Codigo', type: 'SERVER_JS', source: cod2 }, { name: 'Portal', type: 'HTML', source: html }, { name: 'appsscript', type: 'JSON', source: man }] };
}
async function gravarCfgPortal(mudar) {
  const ant = Esc.portal, item = { ...(ant || {}), id: 'portal', ...mudar };
  if (!await gravarItemSec('esc', item, { versaoAberta: ant?.versao || 0, rotulo: 'o portal' })) { await carregarEscala(); throw new Error('outro computador mudou o portal agora; tente de novo'); }
  Esc.portal = item;
}
// erros do programa → o que fazer
function erroApiPortal(e) {
  const m = String(e.message || e);
  if (m.includes('[API_USUARIO]')) return `Falta um sim na conta Google: abra <a href="https://script.google.com/home/usersettings" target="_blank">script.google.com/home/usersettings</a>
    (com a conta da paróquia), ligue a <b>API do Google Apps Script</b> e clique de novo em 🌐 Criar o portal.`;
  const c = /\[API_CLOUD\](\S+)/.exec(m);
  if (c) return `Falta ativar a <b>Apps Script API</b> no Google Cloud da paróquia (o mesmo projeto da ☁ nuvem): abra <a href="${esc(c[1])}" target="_blank">esta página</a>,
    clique em <b>Ativar</b>, espere 1 minuto e clique de novo em 🌐 Criar o portal.`;
  return esc(m.replace(/\[API_\w+\]/g, ''));
}

async function criarPortal() {
  if (Portal.criando) return;
  Portal.criando = true;
  const passos = Portal.passos = [
    { txt: 'Arquivo e conta Google da paróquia' }, { txt: 'Criar o projeto do portal' }, { txt: 'Pôr o código' }, { txt: 'Publicar o portal' }, { txt: 'Autorizar (você clica em Permitir)' }];
  let i = 0;
  const vai = () => { passos[i].ag = true; renderPortalEsc(); };
  const feito = (extra = '') => { passos[i].ag = false; passos[i].ok = true; if (extra) passos[i].txt += ': ' + extra; i++; };
  Portal.situacao = '';
  try {
    vai();
    let st = await arqApp('portalStatus');
    if (!st.temCliente) {
      // sem a ☁ nuvem: o portal só precisa do arquivo do Google (o mesmo da nuvem), não precisa ligar a sincronização
      toast('Escolha o arquivo do Google (JSON) baixado no Google Cloud: Clientes → App para computador → Baixar o JSON.');
      try { await arqApp('googleCarregarCliente', {}, 600000); }
      catch (e) { throw new Error(e.message === 'cancelado' ? 'Falta o arquivo do Google (JSON) para criar o portal.' : e.message); }
      st = await arqApp('portalStatus');
      if (!st.temCliente) throw new Error('O arquivo do Google não foi aceito.');
    }
    if (!st.conectado) { toast('O navegador vai abrir: escolha a conta Google da paróquia e clique em Permitir.'); st = { ...st, ...(await arqApp('portalConectar', {}, 600000)) }; }
    feito(st.email || '');

    vai();
    const c = Esc.portal || {};
    const chave = c.chave && c.scriptId ? c.chave : novaChavePortal();
    let scriptId = c.scriptId;
    if (!scriptId) {
      const nome = 'Portal das pastorais' + (Agenda.dados.paroquia?.nome ? ' · ' + Agenda.dados.paroquia.nome : '');
      scriptId = (await ptApi('POST', 'projects', { title: nome })).scriptId;
      await gravarCfgPortal({ scriptId, chave, url: '', deploymentId: '' });       // se cair no meio, a próxima tentativa usa o mesmo projeto
    }
    feito();

    vai();
    const arq = await arquivosPortal(chave);
    await ptApi('PUT', `projects/${scriptId}/content`, { files: arq.files });
    feito('versão ' + arq.versao);

    vai();
    const v = await ptApi('POST', `projects/${scriptId}/versions`, { description: 'Portal ' + arq.versao });
    const dep = await ptApi('POST', `projects/${scriptId}/deployments`, { versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Portal das pastorais ' + arq.versao });
    const url = (dep.entryPoints || []).map(p => p.webApp?.url).find(Boolean);
    if (!url) throw new Error('o Google publicou, mas não devolveu o endereço do portal');
    await gravarCfgPortal({ scriptId, chave, url, deploymentId: dep.deploymentId });
    Portal.versao = arq.versao;
    feito();

    vai();
    window.open(url, '_blank');
    Portal.situacao = `🔓 O portal abriu no navegador. Se o Google pedir, clique em <b>Revisar permissões</b>, escolha a conta da paróquia e <b>Permitir</b>
      (se aparecer "o Google não verificou este app": <b>Avançado → Acessar</b>; o app é o da própria paróquia).
      Depois volte aqui e clique em <button type="button" id="ptJaPermiti" class="primario">✔ Já permiti</button>`;
  } catch (e) {
    if (passos[i]) { passos[i].ag = false; passos[i].erro = true; }
    Portal.situacao = '⚠ ' + erroApiPortal(e);
  } finally { Portal.criando = false; renderPortalEsc(); }
}

// permissão nova depois de um ⬆ Atualizar: o Google só pergunta no editor do Apps Script
function htmlReautorizar() {
  const id = Esc.portal?.scriptId;
  const ed = id ? `<a href="https://script.google.com/d/${esc(id)}/edit" target="_blank">abra o editor do portal</a>` : 'abra o projeto do portal em script.google.com';
  return `<ol class="esc-pt-passos"><li>${ed} (com a conta da paróquia);</li>
    <li>no alto, escolha a função <b>autorizar</b> e clique em <b>▶ Executar</b>;</li>
    <li>o Google pede autorização: <b>Revisar permissões</b> → a conta → (se aparecer "não verificado": <b>Avançado → Acessar</b>) → <b>Permitir</b>;</li>
    <li>volte aqui e clique em <button type="button" id="ptJaPermiti" class="primario">✔ Já permiti</button></li></ol>`;
}

async function jaPermitiPortal() {
  Portal.situacao = '⏳ Conferindo o portal…'; renderPortalEsc();
  try { await chamarPortal('ping'); }
  catch (e) {
    Portal.situacao = e.reautorizar ? '⚠ Ainda falta a permissão nova.' + htmlReautorizar() : (e.semAutorizar ?'⚠ O Google ainda não deixou o portal funcionar: abra o portal (↗), clique em Permitir e tente de novo. '
      : '⚠ ' + esc(e.message) + ' ') + '<button type="button" id="ptJaPermiti">✔ Já permiti</button>';
    return renderPortalEsc();
  }
  if (Portal.passos) { const p = Portal.passos.at(-1); p.ag = false; p.ok = true; }
  toast('✅ Portal pronto! Copie o link e mande às coordenações das pastorais.');
  await testarPortal();
  Portal.passos = null; renderPortalEsc();
}

async function atualizarCodigoPortal() {
  const c = Esc.portal;
  if (!c?.scriptId || !c?.deploymentId) return toast('Este portal não foi criado pela Secretaria: atualize o código à mão (Avançado).');
  if (!confirm('Pôr o código novo no portal? O link, os cadastros e as escalas continuam os mesmos.')) return;
  Portal.situacao = '⏳ Atualizando o portal…'; renderPortalEsc();
  try {
    const arq = await arquivosPortal(c.chave);
    await ptApi('PUT', `projects/${c.scriptId}/content`, { files: arq.files });
    const v = await ptApi('POST', `projects/${c.scriptId}/versions`, { description: 'Portal ' + arq.versao });
    await ptApi('PUT', `projects/${c.scriptId}/deployments/${c.deploymentId}`, { deploymentConfig: {
      scriptId: c.scriptId, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Portal das pastorais ' + arq.versao } });
    toast('⬆ Portal atualizado para a ' + arq.versao + '.');
    Portal.versaoNova = arq.versao;
    await testarPortal();
    // código novo com permissão nova: o Google pede para o dono autorizar de novo, abrindo o portal
    if (!Portal.usuarios && /autorizado/.test(Portal.situacao)) window.open(c.url, '_blank');
  } catch (e) { Portal.situacao = '⚠ ' + erroApiPortal(e); renderPortalEsc(); }
}

async function salvarCfgPortal() {
  const url = $('#ptUrl').value.trim(), chave = $('#ptChave').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/exec$/.test(url))
    return toast('O endereço do portal começa com https://script.google.com/macros/s/ e termina em /exec.');
  const ant = Esc.portal, item = { ...(ant || {}), id: 'portal', url, chave };
  if (!ant || ant.url !== url || ant.chave !== chave) {
    if (!await gravarItemSec('esc', item, { versaoAberta: ant?.versao || 0, rotulo: 'o portal' })) { await carregarEscala(); return renderPortalEsc(); }
    Esc.portal = item;
  }
  if (url && chave) await testarPortal();
}

async function acaoUsuarioPortal(acao, tr) {
  const id = tr.dataset.ptId, u = Portal.usuarios.find(x => x.id === id);
  const funcoes = [...tr.querySelectorAll('[data-pt-f]:checked')].map(c => c.dataset.ptF);
  if (acao === 'aprovar' && !funcoes.length) return toast('Marque ao menos uma função que a pessoa pode mudar.');
  if (acao === 'recusar' && !confirm(`Recusar o pedido de ${u.nome}?`)) return;
  if (acao === 'apagar' && !confirm(`Apagar o cadastro de ${u.nome} no portal?\n\nA pessoa perde o acesso; o que ela já escreveu na escala continua.`)) return;
  if (acao === 'zerarSenha' && !confirm(`Criar uma senha provisória para ${u.nome}?\n\nA senha atual deixa de valer.`)) return;
  try {
    const r = await chamarPortal(acao, { id, funcoes });
    if (acao === 'zerarSenha') prompt(`Senha provisória de ${u.nome} (passe para a pessoa; no 1º acesso ela escolhe outra):`, r.senha);
    else toast({ aprovar: `✔ ${u.nome} já pode entrar no portal.`, recusar: 'Pedido recusado.', funcoes: 'Funções salvas.', desativar: '⏸ Acesso desativado.', reativar: '▶ Acesso reativado.', apagar: 'Cadastro apagado.' }[acao] || 'Feito.');
    Portal.usuarios = (await chamarPortal('usuarios')).usuarios;
    situacaoPortal();
    renderPortalEsc();
  } catch (e) { toast('⚠ ' + e.message); }
}

async function enviarMesPortal() {
  const mes = $('#ptMes').value;
  if (!mes) return;
  const pac = pacotePortal(mes);
  if (!pac.missas.length) return toast('Nenhuma Missa na Agenda neste mês.');
  try {
    const r = await chamarPortal('enviarMes', pac);
    toast(`📤 ${pac.missas.length} Missas de ${nomeMesPortal(mes)} no portal.` + (r.pendentes ? ` Há ${r.pendentes} mudança(s) das pastorais para conferir (📥).` : ''));
  } catch (e) { toast('⚠ ' + e.message); }
}

const nomeMesPortal = mes => { const [a, m] = mes.split('-').map(Number); return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };

async function trazerPortal() {
  const mes = $('#ptMes').value;
  if (!mes) return;
  try {
    const r = await chamarPortal('lerMes', { mes });
    const ocs = new Map(missasDoMes(mes, '').map(o => [o.chave, o])), linhas = [];
    let fora = 0;
    for (const [k, p] of Object.entries(r.portal || {})) {
      const i = k.lastIndexOf('|'), o = ocs.get(k.slice(0, i)), f = funcoesEsc().find(x => x.id === k.slice(i + 1));
      if (!o || !f) { fora++; continue; }
      const aqui = valorCela(o, f), la = celaDoPortal(p.valor, f);
      if (la === aqui || (la === '—' && !aqui)) continue;           // já está igual
      const d = deIso(o.iso);
      linhas.push({ k, o, f, aqui, la, porNome: p.porNome, em: p.em,
        missa: `${DIAS[d.getDay()].slice(0, 3)} ${dataBR(o.iso).slice(0, 5)} · ${o.hora} · ${nomeCurtoLocal(localDe(o.localId)) || o.texto}`, funcao: f.nome });
    }
    linhas.sort((a, b) => a.o.iso.localeCompare(b.o.iso) || a.o.hora.localeCompare(b.o.hora) || a.funcao.localeCompare(b.funcao));
    Portal.previa = { mes, nomeMes: nomeMesPortal(mes), enviado: r.enviado, linhas, fora, extras: r.extras };
  } catch (e) { Portal.previa = null; toast('⚠ ' + e.message); }
  renderPreviaPortal();
}

async function aplicarPortal() {
  const p = Portal.previa, marcadas = [...$$('#ptPrevia [data-pt-l]:checked')].map(c => p.linhas[+c.dataset.ptL]);
  if (!marcadas.length) return toast('Nada marcado.');
  const rec = Esc.meses[p.mes] || (Esc.meses[p.mes] = { id: 'm-' + p.mes, celas: {} });
  for (const l of marcadas) {
    const k = chaveCela(l.o, l.f.id);
    if (l.la === padraoCela(l.o, l.f)) delete rec.celas[k]; else rec.celas[k] = l.la;
  }
  if (!await gravarItemSec('esc', rec, { versaoAberta: rec.versao || 0, rotulo: 'a escala deste mês' })) { await carregarEscala(); return toast('Outro computador mudou a escala; confira e tente de novo.'); }
  aposMudarEscala();
  toast(`✔ ${marcadas.length} mudança${marcadas.length > 1 ? 's' : ''} na escala de ${p.nomeMes}.`);
  try { await chamarPortal('enviarMes', pacotePortal(p.mes)); } catch (e) { toast('A escala foi salva, mas o portal não recebeu a atualização: ' + e.message); }
  await trazerPortal();
}

async function descartarPortal() {
  const p = Portal.previa, ks = [...$$('#ptPrevia [data-pt-l]:not(:checked)')].map(c => p.linhas[+c.dataset.ptL].k);
  if (!ks.length) return toast('Desmarque as mudanças que não quer.');
  if (!confirm(`Descartar ${ks.length} mudança(s) das pastorais? No portal volta o que está na Secretaria.`)) return;
  try { await chamarPortal('descartar', { mes: p.mes, ks }); toast('Descartadas.'); await trazerPortal(); } catch (e) { toast('⚠ ' + e.message); }
}

function ligarPortalEsc() {
  const painel = $('#dlgEscala [data-esc-painel="portal"]');
  if (!painel) return;
  painel.innerHTML = HTML_PORTAL;
  $('#ptSalvar').addEventListener('click', salvarCfgPortal);
  $('#ptCriarBt').addEventListener('click', criarPortal);
  $('#ptAtualizarCod').addEventListener('click', atualizarCodigoPortal);
  $('#ptAbrir').addEventListener('click', () => Esc.portal?.url && window.open(Esc.portal.url, '_blank'));
  $('#ptAtualizar').addEventListener('click', testarPortal);
  $('#ptCopiar').addEventListener('click', async () => {
    const url = Esc.portal?.url;
    if (!url) return toast('Salve o endereço do portal primeiro.');
    try { await navigator.clipboard.writeText(url); toast('Link do portal copiado.'); } catch (_) { prompt('Link do portal:', url); }
  });
  $('#ptMes').addEventListener('change', () => { Portal.mes = $('#ptMes').value; Portal.previa = null; renderPreviaPortal(); });
  $('#ptEnviar').addEventListener('click', enviarMesPortal);
  $('#ptTrazer').addEventListener('click', trazerPortal);
  painel.addEventListener('click', e => {
    const cp = e.target.closest('[data-pt-copiar]');
    if (cp) return copiarArquivoPortal(cp.dataset.ptCopiar, cp);
    const b = e.target.closest('[data-pt]');
    if (b) return acaoUsuarioPortal(b.dataset.pt, b.closest('tr'));
    if (e.target.id === 'ptJaPermiti') return jaPermitiPortal();
    if (e.target.id === 'ptAplicar') return aplicarPortal();
    if (e.target.id === 'ptDescartar') return descartarPortal();
  });
}

// ao abrir a aba: se já tem portal, testa uma vez (mostra os pedidos novos)
function abrirAbaPortal() {
  renderPortalEsc();
  if (Esc.portal?.url && Esc.portal?.chave && !Portal.usuarios && !Portal.testando) {
    Portal.testando = true;
    testarPortal().finally(() => { Portal.testando = false; });
  }
}
