<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$config = require dirname(__DIR__, 2) . '/app/bootstrap.php';

/** @var \App\Database $db */
function api_db(): \App\Database
{
    static $db;
    if ($db === null) {
        global $config;
        $db = new \App\Database($config);
    }
    return $db;
}

function api_json($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function api_read_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $j = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    return is_array($j) ? $j : [];
}
