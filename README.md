# Secretaria MiguelAngelus

**Agenda e avisos da paróquia** — aplicativo gratuito para Windows, da família do
[MiguelAngelus](https://github.com/dobylucky78-droid/miguelangelus) (projeção para a Missa), feito para a secretaria paroquial.

A Secretaria é um "gerador de conteúdo" para o MiguelAngelus: o que ela cadastra vai pela nuvem da paróquia
e aparece sozinho nos roteiros e no telão.

Contato: contato.miguelangelus@gmail.com (dúvidas, sugestões ou para usar na sua paróquia)

- Criado por **Miguel**, que idealizou o projeto.
- Desenvolvido por **Marcio Aurelio Rios Martins**.

## Baixar

[Instalar-Secretaria-MiguelAngelus.exe](https://github.com/dobylucky78-droid/secretaria-miguelangelus/releases/latest/download/Instalar-Secretaria-MiguelAngelus.exe)
(instalador assinado; instala sem pedir administrador; atualiza-se sozinho pelas versões publicadas aqui).

## O que ela faz

- **Agenda:** dados da paróquia, matriz e capelas; celebrações que se repetem (toda semana, 1ª sexta-feira…);
  calendário do mês, com celebrações avulsas (casamento, batizado…), mudança de horário ou cancelamento num dia.
- **Avisos paroquiais:** cada aviso com data de início e de fim, para todas as comunidades ou só as escolhidas.
- **Próximos 7 dias:** as celebrações da semana e quantos avisos valem em cada uma.
- **Avisos de uma celebração:** folha A4 para ler no ambão (imprimir ou salvar em PDF) e imagens Full HD
  (1920×1080) gravadas na pasta de imagens do Holyrics, para quem projeta com ele.
- **Nuvem:** sincroniza a Agenda e os Avisos com o MiguelAngelus pelo Google Drive da própria paróquia
  (escopo `drive.file`) ou por uma pasta compartilhada. Os avisos se juntam um a um: dois computadores mexendo
  ao mesmo tempo não perdem nada.

Roteiros, cantos e o resto ficam só no MiguelAngelus. A Secretaria não projeta nada.

## Como o código está organizado

A Secretaria é o **mesmo código** do MiguelAngelus, compilado com o símbolo `SECRETARIA` e aberto como
`index.html?app=secretaria`. A tela de controle fica escondida e só a Agenda e os Avisos aparecem.

| Pasta | Conteúdo |
|---|---|
| `lumen/` | A interface (HTML, CSS e JavaScript). `js/secretaria.js` é a tela inicial da Secretaria. |
| `app/` | O aplicativo Windows em C# (.NET Framework 4.8 + WebView2), o mesmo do MiguelAngelus. |
| `secretaria/app/` | `SecretariaMiguelAngelus.csproj`: compila `app/*.cs` com `SECRETARIA` e leva `lumen/` como `web/`. |
| `secretaria/instalador/` | Script do Inno Setup e o script que gera a versão assinada. |
| `secretaria/marca/` | Ícone (anjo com o calendário, fundo amarelo). |

Os dados ficam em `%LOCALAPPDATA%\SecretariaMiguelAngelus`, separados dos do MiguelAngelus. Os dois programas podem
ficar instalados no mesmo computador.

## Como compilar

Requisitos: Windows 10/11, .NET SDK 8 (compila para .NET Framework 4.8), runtime do WebView2. Para o instalador, Inno Setup 6.

```
dotnet publish secretaria/app/SecretariaMiguelAngelus.csproj -c Release -o "secretaria/Secretaria MiguelAngelus App"
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" secretaria\instalador\SecretariaMiguelAngelus.iss
```

`secretaria/instalador/gerar_secretaria.ps1` faz tudo isso e ainda assina o programa e o instalador (precisa do
certificado de assinatura de código e do `signtool`, que não estão no repositório).

## Licença

MIT — veja [LICENSE](LICENSE).
