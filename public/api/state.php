<?php

declare(strict_types=1);

require __DIR__ . '/_init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    api_json(['error' => 'Method not allowed'], 405);
}

try {
    api_json(api_db()->getFullState());
} catch (Throwable $e) {
    api_json(['error' => $e->getMessage()], 500);
}
