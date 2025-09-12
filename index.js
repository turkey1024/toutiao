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
    
    return new Response('每日早报自动发布服务运行中\n访问 /trigger 手动触发', {
      headers: corsHeaders
    });
  }
};

async function processMorningNews(env) {
  console.log('开始处理每日早报数据...');
  
  const newsData = await fetchMorningNews(env.ALAPI_TOKEN);
  console.log('早报数据获取成功，新闻数量:', newsData.data.length);
  
  const issueContent = await formatNewsContent(newsData, env);
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const issueTitle = `每日早报 ${today}`;
  console.log('Issue标题:', issueTitle);
  
  const result = await createGitHubIssue(
    env.GITHUB_OWNER,
    env.GITHUB_REPO,
    issueTitle,
    issueContent,
    env.GITHUB_TOKEN
  );
  
  console.log('Issue创建成功:', result.html_url);
  return result;
}

async function fetchMorningNews(token) {
  console.log('正在调用每日早报API...');
  
  const apiUrl = `https://v3.alapi.cn/api/new/toutiao?token=${token}`;
  console.log('API URL:', apiUrl);
  
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Cloudflare-Worker-Morning-News/1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`早报API请求失败: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('早报API响应代码:', data.code);
  
  if (data.code !== 200 || !data.success) {
    throw new Error(`早报API返回错误: ${data.message || '未知错误'}`);
  }
  
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('早报API返回数据格式不正确');
  }
  
  return data;
}

// 使用原生FormData API的图片上传函数
async function uploadImageToSMMS(imageUrl, smmsToken = '') {
  try {
    if (!imageUrl || imageUrl === '') {
      return imageUrl;
    }
    
    console.log('开始下载图片:', imageUrl);
    
    // 下载图片
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`图片下载失败: ${imageResponse.status}`);
    }
    
    const imageBlob = await imageResponse.blob();
    
    // 创建FormData
    const formData = new FormData();
    formData.append('smfile', imageBlob, 'news.jpg');
    
    // 准备请求头
    const headers = {
      'User-Agent': 'Cloudflare-Worker-Morning-News/1.0'
    };
    
    // 如果有token，添加到header
    if (smmsToken) {
      headers['Authorization'] = smmsToken;
    }
    
    // 上传到SM.MS
    const uploadResponse = await fetch('https://sm.ms/api/v2/upload', {
      method: 'POST',
      headers: headers,
      body: formData
    });
    
    const result = await uploadResponse.json();
    
    if (result.success) {
      console.log('图片上传成功:', result.data.url);
      return result.data.url;
    } else {
      console.error('SM.MS上传失败:', result.message);
      return imageUrl;
    }
    
  } catch (error) {
    console.error('图片处理错误:', error.message);
    return imageUrl;
  }
}

async function formatNewsContent(newsData, env) {
  const newsItems = newsData.data;
  const currentDate = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Shanghai'
  });
  
  let content = `# 📰 每日早报 ${currentDate}\n\n`;
  content += `> 自动生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
  content += "---\n\n";

  // 处理每条新闻
  for (const [index, news] of newsItems.entries()) {
    content += `## ${index + 1}. ${news.title}\n\n`;
    
    if (news.digest && news.digest !== '') {
      content += `**摘要**: ${news.digest}\n\n`;
    }
    
    // 处理图片
    if (news.imgsrc && news.imgsrc !== '') {
      const newImageUrl = await uploadImageToSMMS(news.imgsrc, env.SMMS_TOKEN);
      content += `![新闻图片](${newImageUrl})\n\n`;
    }
    
    content += `**来源**: ${news.source || '未知来源'}\n`;
    content += `**发布时间**: ${news.time}\n`;
    
    // 添加新闻链接
    if (news.pc_url && news.pc_url !== '') {
      content += `[阅读全文](${news.pc_url})\n\n`;
    } else if (news.m_url && news.m_url !== '') {
      content += `[阅读全文](${news.m_url})\n\n`;
    }
    
    content += "---\n\n";
  }
  
  content += `*数据来源: 头条新闻 API | 生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;
  
  return content;
}

async function createGitHubIssue(owner, repo, title, body, token) {
  console.log('正在创建GitHub Issue...');
  
  if (!token) {
    throw new Error('GitHub Token未设置');
  }
  
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Cloudflare-Worker-Morning-News',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: title,
      body: body,
      labels: ['news', 'daily', 'automated']
    })
  });
  
  const responseText = await response.text();
  console.log('GitHub API响应状态:', response.status);
  
  if (!response.ok) {
    throw new Error(`GitHub API错误: ${response.status} - ${responseText}`);
  }
  
  return JSON.parse(responseText);
}

