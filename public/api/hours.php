<?php

declare(strict_types=1);

use InvalidArgumentException;

require __DIR__ . '/_init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    api_json(['error' => 'Method not allowed'], 405);
}

try {
    $body = api_read_body();
    $empId = (int) ($body['employee_id'] ?? $body['employeeId'] ?? 0);
    $month = (string) ($body['month'] ?? $body['month_key'] ?? '');
    $day = (int) ($body['day'] ?? 0);
    $value = $body['value'] ?? '';

    if ($empId <= 0 || $month === '' || $day <= 0) {
        api_json(['error' => 'employee_id, month, day required'], 400);
    }

    api_db()->setHourEntry($empId, $month, $day, $value);
    api_json(['ok' => true]);
} catch (InvalidArgumentException $e) {
    api_json(['error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    api_json(['error' => $e->getMessage()], 500);
}
