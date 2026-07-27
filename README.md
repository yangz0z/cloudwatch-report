# CloudWatch AI Daily Slack Reporter

AWS CloudWatch Logs의 구조화된 오류를 매일 집계하고, 결정적 규칙으로 Incident를 만든 뒤 읽기 쉬운 Slack 리포트로 전송하는 TypeScript Lambda 예제다.

이 저장소는 공개 사용을 전제로 하며 실제 조직의 로그 그룹, endpoint, 오류 메시지, 장애 데이터 또는 credential을 포함하지 않는다. 저장소의 모든 이름과 데이터는 합성 예제다.

## 동작 방식

1. EventBridge Scheduler가 매일 09:00 KST에 Lambda 실행
2. Logs Insights가 전날의 구조화된 `ERROR`·`FATAL` 이벤트를 안전한 필드로만 집계
3. `service + provider + operation + endpoint + errorCode`별 Incident 생성
4. 외부에서 주입한 Detector Rule로 known cause, 권장 조치, 심각도 임계값 적용
5. OpenAI Structured Outputs로 한국어 문장 생성 후 원 Incident와 재검증
6. AI 호출 또는 검증 실패 시 결정적 fallback 리포트 전송
7. Scheduler와 Lambda 비동기 호출의 자동 재시도를 끄고 매일 한 번만 예약 시도

CloudWatch 원문, stack trace, request/response body, 사용자 식별자 및 credential은 OpenAI나 Slack으로 전달하지 않는다.

## 기대하는 구조화 로그

애플리케이션 로그에는 다음과 같은 비식별 필드를 제공해야 한다. 예시는 모두 가상 데이터다. 현재 쿼리는 OpenTelemetry/Serilog 로그와의 호환을 위해 `service.name`, `frontend.service.name`, `error.classification`, `integration.name`, `event.name` 및 일부 snake_case 별칭을 읽는다. 요청 경로는 사용자 식별 정보 유출을 막기 위해 조회하지 않고 `/redacted`로 집계한다.

```json
{
  "@l": "Error",
  "service.name": "example-service",
  "error.classification": "UPSTREAM_TIMEOUT",
  "integration.name": "example-provider",
  "event.name": "fetch_resource",
  "integration.failure": true
}
```

자유 형식의 `message`, 전화번호, 이메일, token, request body 등은 집계 및 리포트 계약에 포함되지 않는다.

## 요구 사항

- Node.js 22.13 이상
- AWS SAM CLI
- AWS 배포 권한
- OpenAI Project API key
- `chat:write` 권한을 가진 Slack Bot token

로컬 fixture 테스트에는 AWS 계정, Docker, OpenAI key, Slack token이 필요하지 않다.

## 안전한 로컬 실행

```bash
npm install
npm run local -- --report-date 2030-01-14
```

기본적으로 다음 합성 fixture를 사용한다.

- `fixtures/events.example.json`
- `fixtures/detector-rules.example.json`

실행 결과는 Slack에 보내지 않고 stdout에 JSON 한 줄로 출력한다. AWS SDK, OpenAI, Slack 네트워크 호출도 발생하지 않는다.

```json
{"messageId":"local-2030-01-14","reportDate":"2030-01-14","text":"..."}
```

다른 합성 fixture를 사용하려면 경로를 명시한다.

```bash
npm run local -- \
  --report-date 2030-01-14 \
  --events fixtures/events.example.json \
  --rules fixtures/detector-rules.example.json
```

실제 운영 로그나 credential을 fixture에 넣거나 커밋하지 않는다. `sam local invoke`는 운영 AWS 어댑터를 실행하므로 이 로컬 fixture 명령과 목적이 다르다.

## 검증

```bash
npm install
npm run check
npm audit
sam validate --lint
sam build
```

## 준비할 값

### OpenAI API key

1. [OpenAI Platform API keys](https://platform.openai.com/settings/organization/api-keys)에서 이 앱 전용 Project/API key 생성
2. [Usage](https://platform.openai.com/usage)와 Project 설정에서 사용량 확인 및 예산 경보 구성
3. 발급된 key는 코드, `.env`, shell history, Git 저장소에 기록하지 않고 AWS Secrets Manager에만 저장

OpenAI 공식 [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys)도 key를 코드나 공개 저장소에 두지 말고 secret 관리 서비스로 주입하도록 권장한다.

### Slack Bot token과 channel ID

1. [Slack App 설정](https://api.slack.com/apps)에서 새 앱 생성
2. `OAuth & Permissions` → `Bot Token Scopes`에서 `chat:write` 추가
3. `Install to Workspace` 또는 `Reinstall to Workspace` 실행
4. `Bot User OAuth Token`의 `xoxb-` token 확인
5. 리포트 대상 채널에서 `/invite @앱이름`으로 Bot 초대
6. 채널 상세 화면에서 channel ID 복사

Slack 공식 [앱 설정 가이드](https://docs.slack.dev/app-management/quickstart-app-settings/)에 따르면 `chat:write`가 메시지 전송 권한이며, Bot이 채널에 참여하지 않는다면 별도 `chat:write.public` 권한이 필요할 수 있다. 이 앱은 최소 권한을 위해 Bot을 대상 채널에 직접 초대하는 방식을 권장한다.

## AWS 설정

### Secrets Manager

앱 전용 secret `/cloudwatch-report/prod/credentials`를 만들고 credential 두 개만 저장한다. AWS Console에서 Secrets Manager → `Store a new secret` → `Other type of secret` → Key/value 방식으로 입력하는 것이 shell history 노출을 피하기 쉽다.

```json
{
  "openaiApiKey": "replace-at-deploy-time",
  "slackBotToken": "replace-at-deploy-time"
}
```

### SSM Parameter Store

`/cloudwatch-report/prod/detector-rules`라는 `String` parameter를 만들고 Detector Rule JSON만 저장한다.

```json
[
    {
      "errorCode": "UPSTREAM_TIMEOUT",
      "service": "example-service",
      "provider": "example-provider",
      "operation": "fetch_resource",
      "knownCause": "가상 upstream의 응답 지연",
      "recommendedActions": ["가상 provider 상태 확인"],
      "warningThreshold": 5,
      "criticalThreshold": 20
    }
]
```

AWS 공식 문서의 [Parameter Store parameter 생성 방법](https://docs.aws.amazon.com/systems-manager/latest/userguide/param-create-cli.html)에 따라 Console 또는 AWS CLI로 생성할 수 있다. 현재 앱은 `String` parameter만 지원한다. 규칙을 비밀로 취급해야 한다면 별도 설계로 `SecureString`, `WithDecryption`, 제한된 KMS 복호화 권한을 함께 추가해야 한다.

Detector Rule의 원인·조치와 구조화 로그의 service·provider·operation·endpoint·errorCode는 OpenAI 및 Slack으로 전달된다. 외부 공유 승인을 받은 비민감 값만 사용하고, 내부 hostname·사용자 ID·credential·자유 형식 오류 원문을 넣지 않는다.

### Lambda 환경변수

SAM이 배포 시 다음 값을 Lambda에 주입한다.

- `SLACK_CHANNEL_ID`: 대상 channel ID
- `DETECTOR_RULES_PARAMETER_NAME`: SSM parameter 이름
- `LOG_GROUP_NAMES`: 조회할 로그 그룹 이름
- `OPENAI_MODEL`: 사용할 OpenAI 모델

## 배포

```bash
sam build
sam deploy --guided
```

배포 과정에서 다음 값을 환경에 맞게 입력한다.

- `LogGroupNames`: 쉼표로 구분한 로그 그룹 이름
- `LogGroupArns`: IAM에서 조회를 허용할 로그 그룹 ARN 목록
- `SecretId`: credential만 보관한 secret ID
- `SecretArn`: Lambda가 읽을 단일 secret의 전체 ARN
- `SlackChannelId`: 대상 Slack channel ID
- `DetectorRulesParameterName`: Detector Rule SSM parameter 이름
- `DetectorRulesParameterArn`: Lambda가 읽을 단일 parameter ARN
- `OpenAiModel`: 사용할 Structured Outputs 지원 모델
- `AlarmTopicArn`: 선택적 실패 알람 SNS topic

Lambda가 VPC에 연결되어 있다면 OpenAI와 Slack API 호출을 위한 NAT 또는 적절한 egress가 필요하다.

## 범위와 제약

- 기본 쿼리는 최대 100개 오류 집계를 반환
- 미등록 오류는 `원인 미확정`으로 표시
- 여러 Incident는 Critical, Warning, Info 및 발생 건수 순으로 정렬
- Scheduler 전달 및 Lambda 비동기 실행의 자동 재시도는 0회로 설정
- Slack의 HTTP 429 응답에 대한 짧은 요청 단위 재시도와 OpenAI 실패 시 fallback은 유지
- 수동 재실행이나 AWS 서비스의 at-least-once 전달로 같은 날짜가 다시 호출되면 Slack 메시지가 중복될 수 있음
- 실행 실패 시 해당 날짜의 리포트는 자동 재시도되지 않으며 실패 Alarm으로만 확인
- CloudWatch Alarm 이력 병합과 실시간 경보는 현재 범위에 포함되지 않음

## 공개 저장소 안전 원칙

- 실제 조직명, domain, account ID, ARN, 로그 그룹 및 endpoint 커밋 금지
- `.env`, SAM 산출물, coverage, credential 파일 커밋 금지
- 공개 전 working tree와 전체 Git 이력에 secret scanner 실행
- 실제 Detector Rule과 장애 fixture는 비공개 저장소 또는 AWS 설정에서만 관리
