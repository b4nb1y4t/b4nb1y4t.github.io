<?php

declare(strict_types=1);

require __DIR__ . '/_init.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $db = api_db();

    if ($method === 'GET') {
        api_json($db->getFullState());
    }

    if ($method === 'POST') {
        $b = api_read_body();
        if (($b['name'] ?? '') === '') {
            api_json(['error' => 'name required'], 400);
        }
        $emp = $db->createEmployee([
            'name' => (string) $b['name'],
            'section' => (string) ($b['section'] ?? 'сборка'),
            'rate' => (float) ($b['rate'] ?? 1),
            'adult' => (bool) ($b['adult'] ?? true),
        ]);
        api_json(['employee' => $emp]);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) {
            api_json(['error' => 'id required'], 400);
        }
        $b = api_read_body();
        $patch = [];
        if (array_key_exists('name', $b)) {
            $patch['name'] = (string) $b['name'];
        }
        if (array_key_exists('section', $b)) {
            $patch['section'] = (string) $b['section'];
        }
        if (array_key_exists('rate', $b)) {
            $patch['rate'] = (float) $b['rate'];
        }
        if (array_key_exists('adult', $b)) {
            $patch['adult'] = (bool) $b['adult'];
        }
        $emp = $db->updateEmployee($id, $patch);
        if ($emp === null) {
            api_json(['error' => 'not found'], 404);
        }
        api_json(['employee' => $emp]);
    }

    if ($method === 'DELETE') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) {
            api_json(['error' => 'id required'], 400);
        }
        $ok = $db->deleteEmployee($id);
        api_json(['ok' => $ok]);
    }

    api_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    api_json(['error' => $e->getMessage()], 500);
}
