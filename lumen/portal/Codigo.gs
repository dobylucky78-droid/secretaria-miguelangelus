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
 *  agenda.json      { eventos: [{ id, titulo, ini, fim, hora, local, pastoral, desc, autor, autorNome, criado, por, porNome, em }] }
 *                   (0.2.0) agenda pastoral: todos que entram veem tudo; cada um põe e muda os eventos das pastorais dele
 *                   (u.pastorais); quem a secretaria marcou como "admin" muda qualquer evento. "paroquia" = eventos da secretaria.
 *                   origem 'sec' (ref = id na Secretaria): os 🎉 eventos com cartaz da Secretaria, que só ela muda (agendaSecretaria).
 *  relatorios.json  { 'pastoral|AAAA-MM': { texto, participantes, por, porNome, em } }   (0.2.0) resumo das atividades do mês
 * LGPD: só nome e e-mail de quem acessa; nas escalas, só nomes. Funções de menores (coroinhas) vão com o 1º nome e a inicial.
 */

const VERSAO_PORTAL = '0.2.0';
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
}
// imagens pequenas do cabeçalho: brasão da paróquia (brasao.json) e, desde a 0.2.0, o logo da Pascom (logo2.json)
function imagem_(nome) {
  const c = CacheService.getScriptCache(), v = c.get(nome);
  if (v) return v === '-' ? '' : v;
  const img = (ler_(nome + '.json', {}) || {}).img || '';
  if (img.length < 100000) c.put(nome, img || '-', 21600);         // o cache guarda até 100 KB
  return img;
}
const brasao_ = () => imagem_('brasao');
function gravarImagem_(nome, valor) {
  const img = String(valor || '');
  if (img && (img.length > 300000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img))) throw falha_('Imagem inválida ou grande demais.');
  if (img !== imagem_(nome)) { gravar_(nome + '.json', { img }); CacheService.getScriptCache().remove(nome); }
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
  pastorais: u.pastorais || [], admin: !!u.admin,
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

// ---------------------------------------------------------------- agenda pastoral (0.2.0)
const PAROQUIA_ = { id: 'paroquia', nome: 'Paróquia (secretaria)' };
function pastoraisConhecidas_() {
  try { return JSON.parse(props_().getProperty('pastorais') || '[]'); } catch (x) { return []; }
}
// a agenda pastoral pode ser vista sem entrar (só ver); a secretaria fecha na chave do portal
const agendaAberta_ = () => props_().getProperty('agendaAberta') !== '0';
const listaPastorais_ = () => [PAROQUIA_].concat(pastoraisConhecidas_().filter(p => p.id !== PAROQUIA_.id));
// a própria pastoral, ou quem a secretaria marcou para mudar tudo; os eventos da paróquia só esses
const podePastoral_ = (u, pid) => !!u.admin || (pid !== PAROQUIA_.id && (u.pastorais || []).indexOf(pid) >= 0);
// os eventos com cartaz que vieram da Secretaria só mudam lá
const podeEvento_ = (u, e) => e.origem !== 'sec' && podePastoral_(u, e.pastoral);
// relatório do mês: só das pastorais da própria pessoa (a "paróquia" não tem relatório)
const relPastorais_ = u => listaPastorais_().filter(p => p.id !== PAROQUIA_.id && (u.admin || (u.pastorais || []).indexOf(p.id) >= 0));
const mesOk_ = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const dataOk_ = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T12:00:00').getTime());
const eventos_ = () => ler_('agenda.json', { eventos: [] }).eventos || [];
const doAno_ = (e, ano) => e.ini.slice(0, 4) <= ano && (e.fim || e.ini).slice(0, 4) >= ano;
function limparEvento_(e, pastorais) {
  const titulo = texto_(e.titulo, 120);
  if (titulo.length < 2) throw falha_('Escreva o nome do evento.');
  const ini = String(e.ini || '');
  if (!dataOk_(ini)) throw falha_('A data do evento não está certa.');
  let fim = String(e.fim || '');
  if (fim && !dataOk_(fim)) throw falha_('A data final não está certa.');
  if (fim && fim < ini) throw falha_('A data final vem antes da data do começo.');
  if (fim === ini) fim = '';
  if (fim && (new Date(fim + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 864e5 > 62) throw falha_('Evento longo demais (mais de dois meses).');
  const hora = String(e.hora || '');
  if (hora && !/^\d{2}:\d{2}$/.test(hora)) throw falha_('A hora não está certa.');
  const pastoral = String(e.pastoral || '');
  if (!pastorais.some(p => p.id === pastoral)) throw falha_('Escolha a pastoral do evento.');
  return { titulo, ini, fim, hora, local: texto_(e.local, 120), pastoral, desc: String(e.desc == null ? '' : e.desc).trim().slice(0, 1000) };
}

// ================================================================ o que a página pode pedir
const PORTAL_ = {
  info() {
    return { versao: VERSAO_PORTAL, paroquia: props_().getProperty('paroquia') || '', brasao: brasao_(), logo2: imagem_('logo2'), funcoes: funcoesConhecidas_().map(f => ({ id: f.id, nome: f.nome })),
      pastorais: pastoraisConhecidas_().map(p => ({ id: p.id, nome: p.nome })), agendaAberta: agendaAberta_() };
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
        pedido: { funcao: texto_(d.funcao, 80), recado: texto_(d.recado, 300),
          quer: (Array.isArray(d.quer) ? d.quer : ['escala', 'calendario']).filter(q => q === 'escala' || q === 'calendario') }, criado: agora_() });
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
      eu: { nome: u.nome, email: u.email, trocarSenha: !!u.trocarSenha, admin: !!u.admin,
        funcoes: (u.funcoes || []).map(id => ({ id, nome: (fs.find(f => f.id === id) || {}).nome || id })),
        pastorais: listaPastorais_().filter(p => podePastoral_(u, p.id)) },
      meses,
    };
  },

  // (0.2.0) agenda pastoral do ano: todos veem tudo; "meu" = pode mudar
  agenda(d) {
    const ano = /^\d{4}$/.test(String(d.ano)) ? String(d.ano) : String(new Date().getFullYear());
    // sem entrar: só ver (se a secretaria deixou aberta), sem os nomes de quem pôs ou mudou
    if (!d.token) {
      if (!agendaAberta_()) throw falha_('A agenda só abre para quem entra no portal.');
      return { ano, pastorais: listaPastorais_(), admin: false, publico: true,
        eventos: eventos_().filter(e => doAno_(e, ano)).map(e => ({ id: e.id, titulo: e.titulo, ini: e.ini, fim: e.fim || '', hora: e.hora || '',
          local: e.local || '', pastoral: e.pastoral, desc: e.desc || '', origem: e.origem || '', meu: false })) };
    }
    const u = sessao_(d);
    return { ano, pastorais: listaPastorais_(), admin: !!u.admin,
      eventos: eventos_().filter(e => doAno_(e, ano)).map(e => Object.assign({}, e, { meu: podeEvento_(u, e) })) };
  },

  // (0.2.0) 📝 relatório das atividades do mês, por pastoral (para a secretaria juntar os relatórios)
  relatorio(d) {
    const u = sessao_(d), mes = String(d.mes || '');
    if (!mesOk_(mes)) throw falha_('Mês inválido.');
    const rel = ler_('relatorios.json', {}), ps = relPastorais_(u);
    return { mes, pastorais: ps, relatorios: ps.map(p => Object.assign({ pastoral: p.id }, rel[p.id + '|' + mes] || {})) };
  },
  relatorioSalvar(d) {
    const u = sessao_(d), mes = String(d.mes || ''), pid = String(d.pastoral || '');
    if (!mesOk_(mes)) throw falha_('Mês inválido.');
    if (!relPastorais_(u).some(p => p.id === pid)) throw falha_('Você só escreve o relatório das suas pastorais.');
    const texto = String(d.texto == null ? '' : d.texto).trim().slice(0, 5000);
    const part = String(d.participantes == null ? '' : d.participantes).replace(/\D/g, '').slice(0, 6);
    return comTrava_(() => {
      const rel = ler_('relatorios.json', {}), k = pid + '|' + mes;
      if (!texto && !part) delete rel[k];
      else rel[k] = { texto, participantes: part, por: u.id, porNome: u.nome, em: agora_() };
      gravar_('relatorios.json', rel);
      return { msg: texto || part ? 'Relatório salvo. A secretaria já pode ver.' : 'Relatório apagado.' };
    });
  },

  agendaSalvar(d) {
    const u = sessao_(d), dado = d.evento || {}, novo = limparEvento_(dado, listaPastorais_());
    if (!podePastoral_(u, novo.pastoral)) throw falha_('Você só pode pôr eventos das suas pastorais.');
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), evs = ag.eventos = ag.eventos || [];
      const id = String(dado.id || '');
      let e = id ? evs.find(x => x.id === id) : null;
      if (id && !e) throw falha_('Este evento não existe mais (alguém apagou). Atualize a agenda.');
      if (e && e.origem === 'sec') throw falha_('Este evento foi marcado na Secretaria: só ela muda.');
      if (e && !podePastoral_(u, e.pastoral)) throw falha_('Só a própria pastoral (ou a secretaria) muda este evento.');
      if (!e) { e = { id: novoId_(), criado: agora_(), autor: u.id, autorNome: u.nome }; evs.push(e); }
      Object.assign(e, novo, { por: u.id, porNome: u.nome, em: agora_() });
      gravar_('agenda.json', ag);
      return { id: e.id, msg: 'Evento salvo.' };
    });
  },

  agendaExcluir(d) {
    const u = sessao_(d), id = String(d.id || '');
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), evs = ag.eventos || [], e = evs.find(x => x.id === id);
      if (!e) return { msg: 'Este evento já tinha sido apagado.' };
      if (e.origem === 'sec') throw falha_('Este evento foi marcado na Secretaria: só ela apaga.');
      if (!podePastoral_(u, e.pastoral)) throw falha_('Só a própria pastoral (ou a secretaria) apaga este evento.');
      ag.eventos = evs.filter(x => x.id !== id);
      gravar_('agenda.json', ag);
      return { msg: 'Evento apagado.' };
    });
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

// (0.2.0) pastorais da agenda e "muda qualquer evento"; a Secretaria antiga (sem esses campos) não mexe neles
function acessoEscala_(u, d) { if (Array.isArray(d.funcoes)) u.funcoes = d.funcoes.map(String); else u.funcoes = u.funcoes || []; }
function acessoAgenda_(u, d) {
  if (Array.isArray(d.pastorais)) u.pastorais = d.pastorais.map(String).filter(p => p !== PAROQUIA_.id);
  if (d.admin !== undefined) u.admin = !!d.admin;
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
    // (0.2.0) pastorais da agenda (a da paróquia já vem sempre)
    if (Array.isArray(d.pastorais))
      props_().setProperty('pastorais', JSON.stringify(d.pastorais.map(p => ({ id: texto_(p.id, 40), nome: texto_(p.nome, 80) }))
        .filter(p => p.id && p.nome && p.id !== PAROQUIA_.id).slice(0, 80)));
    if (d.agendaAberta !== undefined) props_().setProperty('agendaAberta', d.agendaAberta ? '1' : '0');
    // brasão da paróquia (imagem pequena, PNG/JPEG/WebP em data URL) para o cabeçalho do portal; '' tira
    if (d.brasao !== undefined) gravarImagem_('brasao', d.brasao);
    if (d.logo2 !== undefined) gravarImagem_('logo2', d.logo2);       // (0.2.0) logo da Pascom, opcional
    return {};
  },

  usuarios() { return { usuarios: usuarios_().map(publico_) }; },

  aprovar(d) {
    return mudarUsuario_(d.id, u => { u.situacao = 'ativo'; acessoEscala_(u, d); acessoAgenda_(u, d); u.aprovado = u.aprovado || agora_(); });
  },
  // (0.2.0) a escala e o calendário são aprovados cada um no seu card da Secretaria: o que não vem fica como está
  funcoes(d) { return mudarUsuario_(d.id, u => { acessoEscala_(u, d); acessoAgenda_(u, d); }); },
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

  // (0.2.0) agenda pastoral: a Secretaria lê tudo e traz uma programação pronta (ex.: o calendário do ano da paróquia)
  agendaLer() { return { eventos: eventos_(), pastorais: listaPastorais_() }; },
  agendaImportar(d) {
    const ps = listaPastorais_();
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), evs = ag.eventos = ag.eventos || [];
      const chave = e => [e.titulo.toLowerCase(), e.ini, e.pastoral].join('|'), tem = new Set(evs.map(chave));
      let novos = 0, iguais = 0;
      (d.eventos || []).slice(0, 2000).forEach(x => {
        const e = limparEvento_(x || {}, ps);
        if (tem.has(chave(e))) { iguais++; return; }
        tem.add(chave(e));
        evs.push(Object.assign({ id: novoId_(), criado: agora_(), autor: 'secretaria', autorNome: 'Secretaria', por: 'secretaria', porNome: 'Secretaria', em: agora_() }, e));
        novos++;
      });
      if (novos) gravar_('agenda.json', ag);
      return { novos, iguais };
    });
  },
  // a secretaria põe ou muda um evento qualquer (menos os com cartaz, que vêm de agendaSecretaria)
  agendaSalvar(d) {
    const dado = d.evento || {}, novo = limparEvento_(dado, listaPastorais_());
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), evs = ag.eventos = ag.eventos || [];
      const id = String(dado.id || '');
      let e = id ? evs.find(x => x.id === id) : null;
      if (id && !e) throw falha_('Este evento não existe mais (alguém apagou).');
      if (e && e.origem === 'sec') throw falha_('Este evento vem dos 🎉 Eventos da Secretaria: mude por lá.');
      if (!e) { e = { id: novoId_(), criado: agora_(), autor: 'secretaria', autorNome: 'Secretaria' }; evs.push(e); }
      Object.assign(e, novo, { por: 'secretaria', porNome: 'Secretaria', em: agora_() });
      gravar_('agenda.json', ag);
      return { id: e.id };
    });
  },
  // os 🎉 eventos com cartaz da Secretaria: a lista inteira (os que saíram de lá saem daqui)
  agendaSecretaria(d) {
    const ps = listaPastorais_();
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), evs = (ag.eventos || []).filter(e => e.origem !== 'sec');
      const antes = JSON.stringify((ag.eventos || []).filter(e => e.origem === 'sec').map(e => [e.ref, e.titulo, e.ini, e.fim, e.hora, e.local, e.desc]));
      const novos = [];
      (d.eventos || []).slice(0, 500).forEach(x => {
        const ref = texto_(x.ref, 60);
        if (!ref) return;
        try { novos.push(Object.assign({ id: 'sec-' + ref, ref, origem: 'sec', autor: 'secretaria', autorNome: 'Secretaria', por: 'secretaria', porNome: 'Secretaria' },
          limparEvento_(Object.assign({}, x, { pastoral: PAROQUIA_.id }), ps))); } catch (_) {}
      });
      const depois = JSON.stringify(novos.map(e => [e.ref, e.titulo, e.ini, e.fim, e.hora, e.local, e.desc]));
      if (antes !== depois) { ag.eventos = evs.concat(novos.map(e => Object.assign(e, { em: agora_() }))); gravar_('agenda.json', ag); }
      return { eventos: novos.length, mudou: antes !== depois };
    });
  },
  // 📝 relatórios dos meses de..até (AAAA-MM)
  relatoriosLer(d) {
    const de = String(d.de || ''), ate = String(d.ate || de);
    if (!mesOk_(de) || !mesOk_(ate)) throw falha_('Mês inválido.');
    const rel = ler_('relatorios.json', {}), lista = [];
    Object.keys(rel).forEach(k => { const [p, m] = k.split('|'); if (m >= de && m <= ate) lista.push(Object.assign({ pastoral: p, mes: m }, rel[k])); });
    return { relatorios: lista, pastorais: listaPastorais_() };
  },
  agendaExcluir(d) {
    return comTrava_(() => {
      const ag = ler_('agenda.json', { eventos: [] }), antes = (ag.eventos || []).length;
      ag.eventos = (ag.eventos || []).filter(x => x.id !== String(d.id || ''));
      if (ag.eventos.length !== antes) gravar_('agenda.json', ag);
      return { apagados: antes - ag.eventos.length };
    });
  },

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
