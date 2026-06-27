<?php

declare(strict_types=1);

require __DIR__ . '/_init.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $db = api_db();

    if ($method === 'GET') {
        api_json($db->getProductsState());
    }

    if ($method === 'POST') {
        $b = api_read_body();
        $product = $db->createProduct([
            'plu' => (string) ($b['plu'] ?? ''),
            'art' => (string) ($b['art'] ?? ''),
            'name' => (string) ($b['name'] ?? ''),
            'category' => (string) ($b['category'] ?? 'інше'),
        ]);
        api_json(['product' => $product]);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) {
            api_json(['error' => 'id required'], 400);
        }
        $b = api_read_body();
        $patch = [];
        if (array_key_exists('plu', $b)) {
            $patch['plu'] = (string) $b['plu'];
        }
        if (array_key_exists('art', $b)) {
            $patch['art'] = (string) $b['art'];
        }
        if (array_key_exists('name', $b)) {
            $patch['name'] = (string) $b['name'];
        }
        if (array_key_exists('category', $b)) {
            $patch['category'] = (string) $b['category'];
        }
        $product = $db->updateProduct($id, $patch);
        if ($product === null) {
            api_json(['error' => 'not found'], 404);
        }
        api_json(['product' => $product]);
    }

    if ($method === 'DELETE') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) {
            api_json(['error' => 'id required'], 400);
        }
        $ok = $db->deleteProduct($id);
        api_json(['ok' => $ok]);
    }

    api_json(['error' => 'Method not allowed'], 405);
} catch (InvalidArgumentException $e) {
    api_json(['error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    api_json(['error' => $e->getMessage()], 500);
}
