<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 프로젝트 규칙

Meta Global AI Developer Hackathon 제출 프로젝트다. 주제는 아직 정하지 않았고, 지금은 주제와 무관한 기반만 있다.

- **통합 브랜치:** `main`. 분기 기준이자 PR base다.
- **제출 마감:** 2026-11-04 21:00 ET = 2026-11-05 11:00 KST. 늦은 제출은 받지 않는다.
- **제출 필수 항목:** 공개 GitHub 저장소, 3분 데모 영상. [제출 폼](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)과 [참가자 가이드](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)는 로그인해야 보인다.
- **심사 배점:** Impact 30, Use of Meta AI Tooling 25, Demo 25, Technical Depth & Execution 20.

## 반드시 지킬 것

- **새 코드만 쓴다.** 해커톤 기간에 만든 것만 인정되고, 새로 만든 부분을 심사위원이 구별하지 못하면 실격될 수 있다. 다른 프로젝트의 코드를 복사하지 않는다.
- **Muse Wonder를 쓰지 않는다.** 한국에서 제공되지 않고, 해외 서버를 거치는 우회는 Meta 지역 정책 위반이다.
- **API 키는 서버에만 둔다.** `NEXT_PUBLIC_`을 붙이지 않고, 키를 쓰는 모듈에는 `server-only`를 넣는다. 저장소가 공개되므로 `.env*`의 실제 값을 커밋하지 않는다.
- **Contributor 모델에 실제 사용자 데이터를 넣지 않는다.** 보낸 내용이 Meta 모델 학습에 쓰일 수 있다. 코드 기본값은 Standard이고, 개발 환경에서만 `META_TEXT_MODEL`로 켠다.
- **피할 주제:** 의료 조언 AI, 단순 RAG, 단순 이미지 분석기, 단순 교육 챗봇, 채용 지원서 심사, 영양 코치, 성격 분석, 스포츠 분석·코치, 정치·전쟁 관련.

## Meta Model API 연동

- **문서는 원문으로 읽는다.** `https://dev.meta.ai/docs/<경로>.md`로 마크다운을 받을 수 있고, 전체 목록은 `https://dev.meta.ai/llms.txt`에 있다.
- **텍스트:** AI SDK의 `metaTextModel()`과 `metaTextOptions()`를 함께 쓴다. `store: false`와 암호화된 추론 재전송이 Meta 권장 방식이다. 여러 턴에 걸쳐 추론을 유지하려면 UI 스트림에 `sendReasoning: true`가 필요하다.
- **이미지·세그멘테이션:** `metaApiClient()`(OpenAI SDK)로 호출한다. SAM 마스크는 `bounds`에 맞춰 늘려 그린다.
- **Vercel 함수 본문 제한은 4.5MB다.** 큰 파일은 함수로 받지 말고 Blob 직접 업로드를 쓴다. Muse Image는 `response_format: "url"`로 받는다.
- **새 `/api` 경로는 `proxy.ts`의 호출 제한을 자동으로 적용받는다.** 본문 크기 상한은 `parseJsonBody`로 경로마다 정한다. 요청 본문은 곧 과금되는 입력 토큰이다.

## 작업 전후 확인

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run smoke   # 실제 API 호출. 실행당 약 $0.02가 든다.
```
