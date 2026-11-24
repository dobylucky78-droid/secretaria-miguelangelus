/* Portal das pastorais — MiguelAngelus (protótipo 0.1.0, 24/11/2026). Licença MIT.
 *
 * Roda como Google Apps Script NA CONTA DA PARÓQUIA:
 *   Implantar → Nova implantação → App da Web → "Executar como: eu" e "Quem pode acessar: qualquer pessoa".
 * Os dados ficam no Google Drive da paróquia, na pasta "MiguelAngelus Portal" (arquivos .json). Nada vai para servidor nosso.
 *
 * Duas portas:
 *  - doGet  → a página do portal (Portal.html), que chama api(acao, dados) por google.script.run.
 *             Login e senha são do portal (não precisa de conta Google). Só entra quem a secretaria aprovou,
 *             e cada pessoa só vê e muda a escala das funções que a secretaria deu a ela.
 *  - doPost → a Secretaria MiguelAngelus, com a chave da secretaria (gerada por instalar(), no editor).
 *
 * Arquivos na pasta:
 *  usuarios.json    [{ id, nome, email, sal, hash, situacao: 'pendente'|'ativo'|'recusado'|'desativado',
 *                      funcoes: [ids], pedido: { funcao, recado }, trocarSenha, criado, aprovado, ultimo }]
 *  mes-AAAA-MM.json { mes, enviado, funcoes: [{ id, nome, vagas, menores }], missas: [{ chave, iso, hora, texto }],
 *                     base: { 'chave|funcao': 'nomes' }, equipes: { funcao: [{ nome, membros }] }, pessoas: { funcao: [nomes] },
 *                     portal: { 'chave|funcao': { valor, por, porNome, em } } }
 *                   base = o que está na Secretaria; portal = o que as pastorais mudaram e a secretaria ainda não aplicou.
 *  pessoas.json     { funcao: [nomes] }   nomes que a própria coordenação acrescentou (só nomes)
 *  historico.json   [{ em, por, porNome, mes, k, de, para }]   (os últimos 3000)
 * LGPD: só nome e e-mail de quem acessa; nas escalas, só nomes. Funções de menores (coroinhas) vão com o 1º nome e a inicial.
 */

const VERSAO_PORTAL = '0.1.2';
const PASTA_PORTAL = 'MiguelAngelus Portal';
const SESSAO_SEG = 6 * 3600;           // a sessão dura 6 horas (limite do CacheService)
const ITERACOES = 1000;                // PBKDF2-HMAC-SHA256
const TENTATIVAS = 5, BLOQUEIO_SEG = 15 * 60;
const MAX_PENDENTES = 50;
// Resumo (SHA-256, base64) da chave da secretaria. A Secretaria MiguelAngelus cria o portal sozinha e escreve aqui o resumo
// da chave que ela mesma gerou (a chave nunca fica no código). instalar(), se rodado à mão no editor, troca a chave.
const CHAVE_HASH = '';

// ================================================================ portas
// ícone da Secretaria (público, no repositório do programa no GitHub)
const ICONE_PORTAL = 'https://raw.githubusercontent.com/dobylucky78-droid/secretaria-miguelangelus/main/secretaria/marca/icone-256.png';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Portal')
    .setTitle('Portal das pastorais')
    .setFaviconUrl(ICONE_PORTAL)          // o ícone da Secretaria MiguelAngelus na aba do navegador
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, erro: 'Pedido inválido.' }); }
  try {
    checarChave_(req.chave);
    const f = SEC_[req.acao];
    if (!f) throw falha_('Ação desconhecida: ' + req.acao);
    return json_(Object.assign({ ok: true }, f(req) || {}));
  } catch (x) {
    if (!x.publico) console.error(x);
    return json_({ ok: false, erro: x.publico ? x.message : 'Erro no portal: ' + x.message });
  }
}

// a página chama esta função (google.script.run.api)
function api(acao, d) {
  try {
    const f = PORTAL_[acao];
    if (!f) throw falha_('Ação desconhecida.');
    return Object.assign({ ok: true }, f(d || {}) || {});
  } catch (x) {
    if (!x.publico) console.error(x);
    return { ok: false, erro: x.publico ? x.message : 'Não deu certo agora. Tente de novo em instantes.', sair: !!x.sair };
  }
}

// Quando um código novo do portal pede uma permissão nova, o Google só pergunta no editor: escolha "autorizar", ▶ Executar e Permitir.
// Não muda nada (só confere a pasta do portal no Drive).
function autorizar() {
  pasta_();
  Logger.log('Pronto: o portal está autorizado. Pode fechar o editor.');
}

// Rode UMA vez no editor (▶ Executar → instalar): cria a pasta e mostra a chave da secretaria no registro de execução.
// Rodar de novo troca a chave (a antiga deixa de valer).
function instalar() {
  pasta_();
  const chave = 'MA-' + (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24).toUpperCase().match(/.{4}/g).join('-');
  PropertiesService.getScriptProperties().setProperty('chaveHash', resumo_(chave));
  Logger.log('Chave da secretaria: ' + chave);
  Logger.log('Cole na Secretaria MiguelAngelus → 📋 Escalas → 🌐 Portal, junto com o endereço do app da Web (termina em /exec).');
  return chave;
}

// ================================================================ ajudantes
function falha_(msg, sair) { const e = new Error(msg); e.publico = true; e.sair = !!sair; return e; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function agora_() { return new Date().toISOString(); }
function props_() { return PropertiesService.getScriptProperties(); }
function texto_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function bytes_(s) { return Utilities.newBlob(String(s)).getBytes(); }
function resumo_(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function novoId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

function comTrava_(fn) {
  const t = LockService.getScriptLock();
  t.waitLock(20000);
  try { return fn(); } finally { t.releaseLock(); }
}

// ---------------------------------------------------------------- Drive
// A API do Drive direto (UrlFetchApp + o token do próprio script), com o escopo drive.file: o portal só enxerga a pasta e os
// arquivos que ele mesmo criou. (O DriveApp pediria acesso ao Drive inteiro da paróquia.)
const DRIVE_ = 'https://www.googleapis.com/';
function drive_(metodo, caminho, corpo, tipo) {
  const o = { method: metodo, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (corpo !== undefined) { o.payload = corpo; o.contentType = tipo || 'application/json'; }
  const r = UrlFetchApp.fetch(DRIVE_ + caminho, o), c = r.getResponseCode();
  if (c === 404) return null;
  if (c >= 300) throw new Error('Drive ' + c + ': ' + r.getContentText().slice(0, 300));
  return r;
}
function pasta_() {
  const id = props_().getProperty('pastaId');
  if (id) {
    const r = drive_('get', 'drive/v3/files/' + id + '?fields=id,trashed');
    if (r && !JSON.parse(r.getContentText()).trashed) return id;          // apagada ou na lixeira: cria outra
  }
  const p = JSON.parse(drive_('post', 'drive/v3/files?fields=id', JSON.stringify({ name: PASTA_PORTAL, mimeType: 'application/vnd.google-apps.folder' })).getContentText());
  props_().setProperty('pastaId', p.id);
  return p.id;
}
// id do arquivo "nome" na pasta (guardado nas propriedades; se sumiu, procura de novo)
function idArq_(nome, criar) {
  const k = 'arq.' + nome, pasta = pasta_();
  let id = props_().getProperty(k);
  if (id && props_().getProperty('arq.pasta.' + nome) !== pasta) id = '';
  if (!id) {
    const q = encodeURIComponent("name = '" + nome.replace(/'/g, "\\'") + "' and '" + pasta + "' in parents and trashed = false");
    const l = JSON.parse(drive_('get', 'drive/v3/files?q=' + q + '&fields=files(id)&pageSize=1').getContentText());
    id = (l.files && l.files[0] && l.files[0].id) || '';
    if (!id && criar) id = JSON.parse(drive_('post', 'drive/v3/files?fields=id', JSON.stringify({ name: nome, parents: [pasta], mimeType: 'application/json' })).getContentText()).id;
    if (id) { props_().setProperty(k, id); props_().setProperty('arq.pasta.' + nome, pasta); }
  }
  return id;
}
function ler_(nome, padrao) {
  const id = idArq_(nome, false);
  if (!id) return padrao;
  const r = drive_('get', 'drive/v3/files/' + id + '?alt=media');
  if (!r) { props_().deleteProperty('arq.' + nome); return ler_(nome, padrao); }     // apagado à mão: procura de novo
  const txt = r.getContentText('UTF-8');
  if (!txt) return padrao;
  try { return JSON.parse(txt); } catch (x) { return padrao; }
}
function gravar_(nome, obj) {
  const id = idArq_(nome, true);
  const r = drive_('patch', 'upload/drive/v3/files/' + id + '?uploadType=media', JSON.stringify(obj), 'application/json; charset=utf-8');
  if (!r) { props_().deleteProperty('arq.' + nome); gravar_(nome, obj); }
}function brasao_() {
  const c = CacheService.getScriptCache(), v = c.get('brasao');
  if (v) return v === '-' ? '' : v;
  const img = (ler_('brasao.json', {}) || {}).img || '';
  if (img.length < 100000) c.put('brasao', img || '-', 21600);         // o cache guarda até 100 KB
  return img;
}
const nomeMes_ = mes => { if (!/^\d{4}-\d{2}$/.test(String(mes))) throw falha_('Mês inválido.'); return 'mes-' + mes + '.json'; };

// ---------------------------------------------------------------- senhas (PBKDF2-HMAC-SHA256, um bloco)
function hashSenha_(senha, sal) {
  const chave = bytes_(senha);
  let u = Utilities.computeHmacSha256Signature(bytes_(sal).concat([0, 0, 0, 1]), chave);
  const t = u.slice();
  for (let i = 1; i < ITERACOES; i++) {
    u = Utilities.computeHmacSha256Signature(u, chave);
    for (let j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return Utilities.base64Encode(t);
}
function senhaBoa_(s) {
  s = String(s || '');
  if (s.length < 8) throw falha_('A senha precisa de pelo menos 8 letras ou números.');
  if (s.length > 100) throw falha_('Senha comprida demais.');
}
function senhaProvisoria_() {
  const l = 'abcdefghjkmnpqrstuvwxyz', n = '23456789';
  const u = Utilities.getUuid().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 8; i++) { const v = parseInt(u.substr(i * 2, 2), 16); s += i < 4 ? l[v % l.length] : n[v % n.length]; }
  return s.slice(0, 4) + '-' + s.slice(4);
}

// ---------------------------------------------------------------- usuários e sessões
const usuarios_ = () => ler_('usuarios.json', []);
const publico_ = u => ({ id: u.id, nome: u.nome, email: u.email, situacao: u.situacao, funcoes: u.funcoes || [], pedido: u.pedido || {},
  criado: u.criado, aprovado: u.aprovado || '', ultimo: u.ultimo || '', trocarSenha: !!u.trocarSenha });

function sessao_(d) {
  const tk = String(d.token || '');
  const s = tk && CacheService.getScriptCache().get('s:' + tk);
  if (!s) throw falha_('Sua sessão terminou. Entre de novo.', true);
  const [id, ger] = s.split(':'), u = usuarios_().find(x => x.id === id);
  // ger muda quando a secretaria zera a senha: as sessões antigas caem
  if (!u || u.situacao !== 'ativo' || String(u.ger || 0) !== ger) { CacheService.getScriptCache().remove('s:' + tk); throw falha_('Sua sessão terminou ou o acesso mudou. Entre de novo.', true); }
  CacheService.getScriptCache().put('s:' + tk, s, SESSAO_SEG);          // renova
  return u;
}

function funcoesConhecidas_() {
  try { return JSON.parse(props_().getProperty('funcoes') || '[]'); } catch (x) { return []; }
}
function podeFuncao_(u, fid) { if (!(u.funcoes || []).includes(fid)) throw falha_('Você não tem acesso a esta função. Fale com a secretaria.'); }

// ================================================================ o que a página pode pedir
const PORTAL_ = {
  info() {
    return { versao: VERSAO_PORTAL, paroquia: props_().getProperty('paroquia') || '', brasao: brasao_(), funcoes: funcoesConhecidas_().map(f => ({ id: f.id, nome: f.nome })) };
  },

  cadastrar(d) {
    const nome = texto_(d.nome, 80), email = texto_(d.email, 120).toLowerCase();
    if (nome.length < 3) throw falha_('Escreva o seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw falha_('Esse e-mail não parece certo.');
    senhaBoa_(d.senha);
    if (!d.aceite) throw falha_('Marque que leu o aviso sobre os seus dados.');
    return comTrava_(() => {
      const us = usuarios_();
      if (us.some(u => u.email === email && u.situacao !== 'recusado')) throw falha_('Este e-mail já tem cadastro. Se esqueceu a senha, fale com a secretaria.');
      if (us.filter(u => u.situacao === 'pendente').length >= MAX_PENDENTES) throw falha_('Há muitos pedidos esperando a secretaria. Tente de novo em alguns dias.');
      const sal = Utilities.getUuid();
      us.push({ id: novoId_(), nome, email, sal, hash: hashSenha_(d.senha, sal), situacao: 'pendente', funcoes: [],
        pedido: { funcao: texto_(d.funcao, 80), recado: texto_(d.recado, 300) }, criado: agora_() });
      gravar_('usuarios.json', us.filter(u => !(u.email === email && u.situacao === 'recusado')));
      return { msg: 'Pedido enviado. A secretaria da paróquia vai conferir e liberar o seu acesso.' };
    });
  },

  entrar(d) {
    const email = texto_(d.email, 120).toLowerCase(), cache = CacheService.getScriptCache(), kf = 'f:' + resumo_(email);
    const erros = +(cache.get(kf) || 0);
    if (erros >= TENTATIVAS) throw falha_('Muitas tentativas erradas. Espere 15 minutos ou fale com a secretaria.');
    const us = usuarios_(), u = us.find(x => x.email === email);
    if (!u || hashSenha_(d.senha, u.sal) !== u.hash) {
      cache.put(kf, String(erros + 1), BLOQUEIO_SEG);
      throw falha_('E-mail ou senha não conferem.');
    }
    cache.remove(kf);
    if (u.situacao === 'pendente') throw falha_('Seu cadastro ainda espera a aprovação da secretaria.');
    if (u.situacao !== 'ativo') throw falha_('Este acesso não está liberado. Fale com a secretaria.');
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    cache.put('s:' + token, u.id + ':' + (u.ger || 0), SESSAO_SEG);
    comTrava_(() => { const v = usuarios_(), x = v.find(y => y.id === u.id); if (x) { x.ultimo = agora_(); gravar_('usuarios.json', v); } });
    return { token, trocarSenha: !!u.trocarSenha };
  },

  sair(d) { if (d.token) CacheService.getScriptCache().remove('s:' + d.token); return {}; },

  eu(d) {
    const u = sessao_(d), fs = funcoesConhecidas_();
    const meses = JSON.parse(props_().getProperty('meses') || '[]');
    return {
      paroquia: props_().getProperty('paroquia') || '',
      eu: { nome: u.nome, email: u.email, trocarSenha: !!u.trocarSenha,
        funcoes: (u.funcoes || []).map(id => ({ id, nome: (fs.find(f => f.id === id) || {}).nome || id })) },
      meses,
    };
  },

  trocarSenha(d) {
    const u = sessao_(d);
    if (hashSenha_(d.atual, u.sal) !== u.hash) throw falha_('A senha atual não confere.');
    senhaBoa_(d.nova);
    if (d.nova === d.atual) throw falha_('Escolha uma senha diferente da atual.');
    return comTrava_(() => {
      const us = usuarios_(), x = us.find(y => y.id === u.id);
      x.sal = Utilities.getUuid(); x.hash = hashSenha_(d.nova, x.sal); delete x.trocarSenha;
      gravar_('usuarios.json', us);
      return { msg: 'Senha trocada.' };
    });
  },

  escala(d) {
    const u = sessao_(d), fid = String(d.funcao || '');
    podeFuncao_(u, fid);
    const m = ler_(nomeMes_(d.mes), null);
    if (!m) throw falha_('A secretaria ainda não mandou as Missas deste mês.');
    const f = (m.funcoes || []).find(x => x.id === fid);
    if (!f) throw falha_('Esta função não está na escala deste mês.');
    const extras = (ler_('pessoas.json', {})[fid]) || [];
    const linhas = (m.missas || []).map(o => {
      const k = o.chave + '|' + fid, p = (m.portal || {})[k];
      return { chave: o.chave, iso: o.iso, hora: o.hora, texto: o.texto, base: (m.base || {})[k] || '',
        portal: p ? { valor: p.valor, porNome: p.porNome, em: p.em } : null };
    });
    return { mes: m.mes, enviado: m.enviado, funcao: f, linhas, equipes: (m.equipes || {})[fid] || [],
      pessoas: Array.from(new Set(((m.pessoas || {})[fid] || []).concat(extras))).sort((a, b) => a.localeCompare(b, 'pt-BR')), extras };
  },

  salvar(d) {
    const u = sessao_(d), fid = String(d.funcao || '');
    podeFuncao_(u, fid);
    return comTrava_(() => {
      const nome = nomeMes_(d.mes), m = ler_(nome, null);
      if (!m) throw falha_('A secretaria ainda não mandou as Missas deste mês.');
      m.portal = m.portal || {};
      const hist = ler_('historico.json', []), chaves = new Set((m.missas || []).map(o => o.chave));
      let n = 0;
      Object.keys(d.celas || {}).forEach(chave => {
        if (!chaves.has(chave)) return;
        const k = chave + '|' + fid, novo = texto_(d.celas[chave], 200), base = (m.base || {})[k] || '';
        const atual = m.portal[k] ? m.portal[k].valor : base;
        if (novo === atual) return;
        if (novo === base) delete m.portal[k];
        else m.portal[k] = { valor: novo, por: u.id, porNome: u.nome, em: agora_() };
        hist.push({ em: agora_(), por: u.id, porNome: u.nome, mes: m.mes, k, de: atual, para: novo });
        n++;
      });
      if (n) { gravar_(nome, m); gravar_('historico.json', hist.slice(-3000)); }
      return { mudou: n, msg: n ? `Salvo (${n} Missa${n > 1 ? 's' : ''}). A secretaria confere e põe na escala impressa.` : 'Nada mudou.' };
    });
  },

  salvarPessoas(d) {
    const u = sessao_(d), fid = String(d.funcao || '');
    podeFuncao_(u, fid);
    const nomes = Array.from(new Set((d.nomes || []).map(n => texto_(n, 60)).filter(Boolean))).slice(0, 300);
    return comTrava_(() => {
      const ps = ler_('pessoas.json', {});
      ps[fid] = nomes;
      gravar_('pessoas.json', ps);
      return { msg: 'Lista de nomes salva.' };
    });
  },
};

// ================================================================ o que a Secretaria pode pedir (com a chave)
function checarChave_(c) {
  const h = props_().getProperty('chaveHash') || CHAVE_HASH;
  if (!h) throw falha_('O portal ainda não tem a chave da secretaria (crie o portal pela Secretaria MiguelAngelus).');
  if (!c || resumo_(c) !== h) { Utilities.sleep(800); throw falha_('A chave da secretaria não confere.'); }
}

function mudarUsuario_(id, fn) {
  return comTrava_(() => {
    const us = usuarios_(), u = us.find(x => x.id === id);
    if (!u) throw falha_('Pessoa não encontrada (atualize a lista).');
    const r = fn(u, us) || {};
    gravar_('usuarios.json', us.filter(x => !x.apagar));
    return r;
  });
}

const SEC_ = {
  ping() {
    const us = usuarios_();
    return { versao: VERSAO_PORTAL, ativos: us.filter(u => u.situacao === 'ativo').length, pendentes: us.filter(u => u.situacao === 'pendente').length };
  },

  // nome da paróquia e funções (para o cadastro escolher a pastoral)
  configurar(d) {
    props_().setProperty('paroquia', texto_(d.paroquia, 120));
    props_().setProperty('funcoes', JSON.stringify((d.funcoes || []).map(f => ({ id: texto_(f.id, 40), nome: texto_(f.nome, 80) }))));
    // brasão da paróquia (imagem pequena, PNG/JPEG/WebP em data URL) para o cabeçalho do portal; '' tira
    if (d.brasao !== undefined) {
      const img = String(d.brasao || '');
      if (img && (img.length > 300000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img))) throw falha_('Imagem do brasão inválida ou grande demais.');
      if (img !== brasao_()) { gravar_('brasao.json', { img }); CacheService.getScriptCache().remove('brasao'); }
    }
    return {};
  },

  usuarios() { return { usuarios: usuarios_().map(publico_) }; },

  aprovar(d) {
    return mudarUsuario_(d.id, u => { u.situacao = 'ativo'; u.funcoes = (d.funcoes || []).map(String); u.aprovado = u.aprovado || agora_(); });
  },
  funcoes(d) { return mudarUsuario_(d.id, u => { u.funcoes = (d.funcoes || []).map(String); }); },
  recusar(d) { return mudarUsuario_(d.id, u => { u.situacao = 'recusado'; u.funcoes = []; }); },
  desativar(d) { return mudarUsuario_(d.id, u => { u.situacao = 'desativado'; }); },
  reativar(d) { return mudarUsuario_(d.id, u => { u.situacao = 'ativo'; }); },
  zerarSenha(d) {
    const nova = senhaProvisoria_();
    mudarUsuario_(d.id, u => { u.sal = Utilities.getUuid(); u.hash = hashSenha_(nova, u.sal); u.trocarSenha = true; u.ger = (u.ger || 0) + 1; });
    CacheService.getScriptCache().remove('f:' + resumo_((usuarios_().find(u => u.id === d.id) || {}).email || ''));
    return { senha: nova };
  },
  // LGPD: apaga o cadastro (o nome continua só no histórico de mudanças da escala)
  apagar(d) { return mudarUsuario_(d.id, u => { u.apagar = true; }); },

  // as Missas do mês, o que está na escala da Secretaria, equipes e nomes de cada função
  enviarMes(d) {
    return comTrava_(() => {
      const nome = nomeMes_(d.mes), ant = ler_(nome, {}), base = d.base || {};
      const chaves = new Set((d.missas || []).map(o => o.chave));
      const portal = {};
      // o que as pastorais mudaram continua, a não ser que a Missa saiu ou a Secretaria já pôs o mesmo valor
      Object.keys(ant.portal || {}).forEach(k => {
        const p = ant.portal[k], chave = k.slice(0, k.lastIndexOf('|'));
        if (chaves.has(chave) && p.valor !== (base[k] || '')) portal[k] = p;
      });
      gravar_(nome, { mes: d.mes, enviado: agora_(), funcoes: d.funcoes || [], missas: d.missas || [], base,
        equipes: d.equipes || {}, pessoas: d.pessoas || {}, portal });
      const meses = JSON.parse(props_().getProperty('meses') || '[]').filter(x => x !== d.mes).concat([d.mes]).sort().slice(-6);
      props_().setProperty('meses', JSON.stringify(meses));
      return { pendentes: Object.keys(portal).length };
    });
  },

  lerMes(d) {
    const m = ler_(nomeMes_(d.mes), null);
    return m ? { enviado: m.enviado, portal: m.portal || {}, extras: ler_('pessoas.json', {}) } : { enviado: '', portal: {}, extras: {} };
  },

  // a secretaria não quis estas mudanças
  descartar(d) {
    return comTrava_(() => {
      const nome = nomeMes_(d.mes), m = ler_(nome, null);
      if (!m) return { n: 0 };
      let n = 0;
      (d.ks || []).forEach(k => { if (m.portal && m.portal[k]) { delete m.portal[k]; n++; } });
      if (n) gravar_(nome, m);
      return { n };
    });
  },

  historico(d) {
    const h = ler_('historico.json', []).filter(x => !d.mes || x.mes === d.mes);
    return { historico: h.slice(-300) };
  },
};
