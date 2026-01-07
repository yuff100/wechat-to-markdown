import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { message: 'URL is required' },
        { status: 400 }
      );
    }

    // Fetch the WeChat article with a user-agent to avoid being blocked
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Extract article title
    const title = $('#activity-name').text().trim() || 'Untitled WeChat Article';

    // Extract author if available
    const author = $('#js_name').text().trim() || '';

    // Extract publish time if available
    const publishTime = $('#publish_time').text().trim() || '';

    // Extract the article content
    const content = $('#js_content').html() || '';

    // Convert CSS-based bold styling to semantic HTML before processing
    // WeChat often uses inline styles instead of <strong> or <b> tags
    $('#js_content [style*="font-weight"]').each((_, element) => {
      const $el = $(element);
      const style = $el.attr('style') || '';
      
      // Check if font-weight is bold (700 or bold keyword)
      if (style.match(/font-weight:\s*(bold|700|600|800|900)/i)) {
        const content = $el.html();
        // Wrap content with strong tag
        $el.replaceWith(`<strong>${content}</strong>`);
      }
    });

    // Prepare image storage information
    const images = [];

    // Process all images in the content
    $('#js_content img').each((index, element) => {
      const originalSrc = $(element).attr('data-src') || $(element).attr('src');

      if (originalSrc) {
        const extension = originalSrc.split('?')[0].split('.').pop() || 'jpg';
        const imageId = uuidv4();
        const filename = `${imageId}.jpg`;

        // Update image source to relative path for markdown
        $(element).attr('src', `./images/${filename}`);

        // Add image to collection
        images.push({
          url: originalSrc,
          filename,
          index: index + 1
        });
      }
    });

    // Initialize turndown service for HTML to Markdown conversion
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      preformattedCode: true
    });

    // Add a rule to handle code blocks with proper newline preservation
    turndownService.addRule('codeBlocks', {
      filter: function(node) {
        return node.nodeName === 'PRE';
      },
      replacement: function(content, node) {
        // Get the HTML content of the pre tag
        let html = node.innerHTML || '';
        
        // Replace all <br> and <br/> tags with newline characters
        html = html.replace(/<br\s*\/?>/gi, '\n');
        
        // Create a temporary element to extract text from modified HTML
        const tempDiv = node.ownerDocument.createElement('div');
        tempDiv.innerHTML = html;
        const code = tempDiv.textContent || tempDiv.innerText || '';
        
        // Extract language from class attribute
        let lang = '';
        const preClass = node.className || '';
        const codeEl = node.querySelector('code');
        const codeClass = codeEl ? codeEl.className : '';
        
        // Try to find language
        const combinedClass = preClass + ' ' + codeClass;
        const langMatch = combinedClass.match(/(?:lang-|language-)(\w+)/);
        if (langMatch) {
          lang = langMatch[1];
        } else if (combinedClass.includes('ruby')) {
          lang = 'bash';
        } else if (combinedClass.includes('python')) {
          lang = 'python';
        } else if (combinedClass.includes('javascript')) {
          lang = 'javascript';
        } else if (combinedClass.includes('cpp')) {
          lang = 'cpp';
        }
        
        return '\n```' + lang + '\n' + code + '\n```\n\n';
      }
    });

    // Fix strong tag conversion to prevent line breaks before closing **
    // This rule should come BEFORE wechatStyles so it processes strong tags first
    turndownService.addRule('strongFix', {
      filter: 'strong',
      replacement: function(content, node) {
        // Trim content inside the bold markers
        const trimmedContent = content.trim();
        
        // Check if strong is the main content of its parent block element
        const parent = node.parentNode;
        if (parent && ['P', 'SECTION', 'DIV'].includes(parent.nodeName)) {
          // Get parent's text content and compare with strong's text
          const parentText = parent.textContent.trim();
          const strongText = node.textContent.trim();
          
          // If strong is the dominant content (>60% of parent), it's likely a heading
          // Add line breaks after it
          if (strongText.length > 0 && strongText.length / parentText.length > 0.6) {
            return `**${trimmedContent}**\n\n`;
          }
        }
        
        return `**${trimmedContent}**`;
      }
    });

    // Removed wechatStyles rule - let default paragraph handling work
    // and let strongFix handle the line breaks

    // Convert HTML to Markdown
    const contentHtml = $('#js_content').html();
    let markdown = turndownService.turndown(contentHtml);

    // Add article metadata at the top
    let articleInfo = `# ${title}\n\n`;
/*
    if (author) {
      articleInfo += `> 作者：${author}\n>\n`;
    }

    if (publishTime) {
      articleInfo += `> 发布时间：${publishTime}\n>\n`;
    }

    articleInfo += `> 原文链接：${url}\n\n`;
**/
    markdown = articleInfo + markdown;

    // Generate an ID for this conversion
    const conversionId = uuidv4();

    // Return the markdown, title, and images
    return NextResponse.json({
      id: conversionId,
      title,
      author,
      publishTime,
      markdown,
      images,
      originalUrl: url
    });

  } catch (error) {
    console.error('Error converting article:', error);

    return NextResponse.json(
      { message: 'Failed to convert article: ' + (error.message || 'Unknown error') },
      { status: 500 }
    );
  }
}