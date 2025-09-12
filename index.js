export default {
  async scheduled(event, env, ctx) {
    try {
      await processMorningNews(env);
    } catch (error) {
      console.error('定时任务执行失败:', error.message);
    }
  },

  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      try {
        const result = await processMorningNews(env);
        return new Response(JSON.stringify({
          success: true,
          message: '手动触发成功',
          issue_url: result.html_url
        }), {
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

