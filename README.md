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
7. DynamoDB 조건부 쓰기와 lease로 날짜별 중복 실행 방지

CloudWatch 원문, stack trace, request/response body, 사용자 식별자 및 credential은 OpenAI나 Slack으로 전달하지 않는다.

## 기대하는 구조화 로그

애플리케이션 로그에는 다음과 같은 비식별 필드를 제공해야 한다. 예시는 모두 가상 데이터다.

```json
{
  "level": "ERROR",
  "service": "example-service",
  "category": "external_dependency",
  "provider": "example-provider",
  "operation": "fetch_resource",
  "endpoint": "/v1/resources",
  "errorCode": "UPSTREAM_TIMEOUT"
}
```

자유 형식의 `message`, 전화번호, 이메일, token, request body 등은 집계 및 리포트 계약에 포함되지 않는다.

## 요구 사항

- Node.js 22 이상
- AWS SAM CLI
- AWS 배포 권한
- OpenAI Project API key
- `chat:write` 권한을 가진 Slack Bot token

## 검증

```bash
npm install
npm run check
npm audit
sam validate --lint
sam build
```

## 비밀값과 Detector Rule

AWS Secrets Manager에 다음 형태의 JSON을 저장한다. 이 파일을 저장소에 만들거나 커밋하지 않는다.

```json
{
  "openaiApiKey": "replace-at-deploy-time",
  "slackBotToken": "replace-at-deploy-time",
  "slackChannelId": "replace-at-deploy-time",
  "detectorRules": [
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
}
```

실제 조직의 오류 코드·원인·조치가 운영정보라면 별도 비공개 설정으로만 관리한다. credential과 비밀이 아닌 규칙을 더 엄격히 분리하려면 Detector Rule을 SSM Parameter Store 또는 AWS AppConfig로 옮길 수 있다.

## 배포

```bash
sam build
sam deploy --guided
```

배포 과정에서 다음 값을 환경에 맞게 입력한다.

- `LogGroupNames`: 쉼표로 구분한 로그 그룹 이름
- `LogGroupArns`: IAM에서 조회를 허용할 로그 그룹 ARN 목록
- `SecretId`: credential과 Detector Rule을 보관한 secret ID
- `SecretArn`: Lambda가 읽을 단일 secret의 전체 ARN
- `OpenAiModel`: 사용할 Structured Outputs 지원 모델
- `AlarmTopicArn`: 선택적 실패 알람 SNS topic

Lambda가 VPC에 연결되어 있다면 OpenAI와 Slack API 호출을 위한 NAT 또는 적절한 egress가 필요하다.

## 범위와 제약

- 기본 쿼리는 최대 100개 오류 집계를 반환
- 미등록 오류는 `원인 미확정`으로 표시
- 여러 Incident는 Critical, Warning, Info 및 발생 건수 순으로 정렬
- Slack 성공 직후 DynamoDB 상태 기록 전에 실행이 중단되는 극단적 구간에는 중복 가능성이 남음
- CloudWatch Alarm 이력 병합과 실시간 경보는 현재 범위에 포함되지 않음

## 공개 저장소 안전 원칙

- 실제 조직명, domain, account ID, ARN, 로그 그룹 및 endpoint 커밋 금지
- `.env`, SAM 산출물, coverage, credential 파일 커밋 금지
- 공개 전 working tree와 전체 Git 이력에 secret scanner 실행
- 실제 Detector Rule과 장애 fixture는 비공개 저장소 또는 AWS 설정에서만 관리
