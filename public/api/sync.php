<?php

declare(strict_types=1);

require __DIR__ . '/_init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    api_json(['error' => 'Method not allowed'], 405);
}

try {
    $body = api_read_body();
    /** @var array<int, array<string, mixed>> $employees */
    $employees = $body['employees'] ?? [];
    if (!is_array($employees) || $employees === []) {
        api_json(['error' => 'employees array required'], 400);
    }
    api_db()->importEmployeesPayload($employees);
    api_json(api_db()->getFullState());
} catch (Throwable $e) {
    api_json(['error' => $e->getMessage()], 500);
}
