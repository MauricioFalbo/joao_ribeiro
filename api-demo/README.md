# API Demo: Luminárias Inteligentes

API REST pequena para **praticar Postman**: filtros por query string, ids por path params, CRUD completo e autenticação por token com respostas **401** e **403**.
Os dados ficam salvos localmente em `data/devices.json`, que é criado na primeira execução.

## Como rodar

```bash
cd api-demo
npm install
npm start          # http://localhost:3000
# ou: npm run dev  (reinicia ao salvar o arquivo)
```

## Swagger (documentação interativa)

Com a API rodando, abra **http://localhost:3000/docs**.

- O contrato está em [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0) e também é servido em `/openapi.yaml` e `/openapi.json`.
- Clique em **Authorize** e cole `token-leitor-123` ou `token-admin-456` para testar as rotas `/secure/*`.
- Em cada rota, use **Try it out → Execute** para fazer a chamada pelo browser.
- Para gerar uma collection no Postman a partir do contrato: **Import → Link → `http://localhost:3000/openapi.json`**.

Cada pedido aparece no terminal com método, URL, status e tempo de resposta. É o "outro lado" da integração.

## Importar no Postman

1. **Import** → selecione os dois arquivos da pasta `postman/`.
2. No canto superior direito, escolha o environment **API Demo - Local**.
3. Abra a collection e rode as pastas pela ordem: 0 → 5.
4. Para rodar tudo de uma vez, use **Run collection** e veja os testes passarem.

## Rotas

| Método | Rota | O que demonstra |
|---|---|---|
| GET | `/docs` | Swagger UI |
| GET | `/` | Lista de rotas |
| GET | `/health` | Health check |
| GET | `/devices` | Lista com **filtros por query** |
| GET | `/devices/:id` | Busca por **id via params** (400 se inválido, 404 se não existir) |
| GET | `/cities/:city/devices?status=` | Params e query juntos |
| POST | `/devices` | Criar → **201** + header `Location` (422 validação, 409 duplicado) |
| PUT | `/devices/:id` | Substituir o recurso completo |
| PATCH | `/devices/:id` | Atualizar só alguns campos |
| DELETE | `/devices/:id` | Apagar → **204** sem body |
| POST | `/devices/:id/attachments` | **Upload** com `multipart/form-data` → 201 (400, 404, 413, 415) |
| GET | `/devices/:id/attachments` | Lista os anexos |
| GET | `/attachments/:attachmentId` | Baixa o arquivo |
| DELETE | `/attachments/:attachmentId` | Apaga o anexo |
| POST | `/reset` | Restaura os dados iniciais e apaga os anexos |
| GET | `/secure/me` | Qualquer token válido |
| GET | `/secure/reports/faults` | Qualquer token válido |
| POST | `/secure/devices/:id/reboot` | **Só admin** (viewer recebe 403) |
| DELETE | `/secure/devices` | **Só admin**: apaga tudo |

### Filtros disponíveis em `GET /devices`

| Query | Exemplo | Efeito |
|---|---|---|
| `city` | `?city=Lisboa` | Cidade (não diferencia maiúsculas) |
| `country` | `?country=PT` | País |
| `status` | `?status=fault` | `on`, `off` ou `fault` (outro valor → 400) |
| `type` | `?type=sensor` | `luminaria` ou `sensor` |
| `minDim` | `?minDim=50` | Nível de dim mínimo |
| `q` | `?q=MAD` | Pesquisa no nome |
| `sort` / `order` | `?sort=dimLevel&order=desc` | Ordenação |
| `page` / `limit` | `?page=2&limit=3` | Paginação (total no header `X-Total-Count`) |

Os filtros podem ser combinados: `/devices?country=PT&status=fault&type=luminaria`.

## Upload de arquivos (multipart/form-data)

`POST /devices/:id/attachments` não recebe JSON: recebe um formulário `multipart/form-data`.

- Campo `file` (obrigatório): PNG, JPEG, PDF, CSV ou TXT, até **2 MB**.
- Campo `description` (opcional): texto.
- Os arquivos ficam em `data/uploads/` e os metadados em `data/attachments.json`.

**No Postman:** Body → **form-data** → chave `file`, mude o tipo de *Text* para **File** e escolha o arquivo. Não preencha o header `Content-Type` à mão: o Postman gera o `boundary` sozinho.

| Situação | Resposta |
|---|---|
| Arquivo válido | **201** + header `Location` |
| Sem arquivo, ou campo com outro nome | **400** |
| Dispositivo não existe | **404** |
| Maior que 2 MB | **413** |
| Body em JSON em vez de multipart | **415** `UNSUPPORTED_MEDIA_TYPE` |
| Tipo não permitido (ex.: .exe) | **415** `UNSUPPORTED_FILE_TYPE` |

```bash
curl -F "file=@foto.jpg" -F "description=Foto da avaria" http://localhost:3000/devices/2/attachments
```

## Autenticação: 401 vs 403

Envie o header `Authorization: Bearer <token>`.

| Token | Perfil |
|---|---|
| `token-leitor-123` | `viewer`: pode ler |
| `token-admin-456` | `admin`: pode ler e executar ações |

| Situação | Resposta |
|---|---|
| Sem header `Authorization` | **401** `MISSING_TOKEN` |
| Header sem `Bearer ` | **401** `MALFORMED_TOKEN` |
| Token desconhecido | **401** `INVALID_TOKEN` |
| Token válido, perfil sem permissão | **403** `FORBIDDEN` |
| Token válido e com permissão | **200** / **202** |

> **401 = "não sei quem você é"** (autenticação).
> **403 = "sei quem você é, mas você não pode fazer isto"** (autorização).

## Formato dos erros

Todos os erros seguem o mesmo formato, o que facilita o diagnóstico e o envio de evidências:

```json
{
  "error": { "status": 404, "code": "NOT_FOUND", "message": "Dispositivo 99 não encontrado." },
  "requestId": "cea5bcf5-8a4a-45e4-b465-5119490899b8"
}
```

## Exemplos com curl

```bash
curl "http://localhost:3000/devices?city=Lisboa&status=fault"
curl  http://localhost:3000/devices/2
curl -X POST http://localhost:3000/devices -H "Content-Type: application/json" \
     -d '{"name":"LUM-FAR-0001","city":"Faro","country":"PT","type":"luminaria","status":"on","dimLevel":70}'
curl -H "Authorization: Bearer token-leitor-123" -X POST http://localhost:3000/secure/devices/2/reboot   # 403
curl -H "Authorization: Bearer token-admin-456"  -X POST http://localhost:3000/secure/devices/2/reboot   # 202
```
